// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTask } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";
import { BoardTicketWorkFollower } from "./board-ticket-work-follower";

// Failure modes: a ticket stays in Running after its thread finished, so the person moves every card;
// a ticket past the agent's limit shows Running while it waits, or stays Queued after a slot frees; a
// failed or stopped thread leaves its ticket in Running with no reason; a snapshot that only changes a
// progress line drags a card back from where the person put it; a thread that ends a turn takes a ticket
// out of Done that the person approved; the agent's own update moves another thread's ticket.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function harness(startState: AgentTask["state"] = "running") {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-follower-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  let started = 0;
  const board = new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async () => {
      started += 1;
      return { id: `task-${started}`, threadId: `thread-${started}`, state: startState };
    },
  });
  const follower = new BoardTicketWorkFollower(board);
  const follow = (...tasks: AgentTask[]) => follower.follow({ agentId: "chief", tasks, limit: 1 });
  return { board, follow };
}

function work(id: string, state: AgentTask["state"], change: Partial<AgentTask> = {}): AgentTask {
  return {
    id,
    agentId: "chief",
    threadId: `thread-${id}`,
    origin: "user",
    title: "Fix the login timeout",
    state,
    outcome: null,
    hold: null,
    activeTurnId: state === "running" ? "turn-1" : null,
    progress: null,
    error: null,
    queuedMessages: [],
    createdAt: "2026-10-29T08:00:00.000Z",
    updatedAt: "2026-10-29T08:00:00.000Z",
    closedAt: state === "closed" ? "2026-10-29T09:00:00.000Z" : null,
    question: null,
    ...change,
  };
}

describe("board ticket work follower", () => {
  it("moves a started ticket from Running to Needs review when its thread ends the turn", async () => {
    const { board, follow } = await harness();
    const ticket = await board.start({ agentId: "chief", title: "Fix the login timeout" });
    expect(ticket.status).toBe("running");

    follow(work("task-1", "running", { progress: "Reading the session code" }));
    expect(board.get(ticket.id)?.status).toBe("running");
    follow(work("task-1", "idle", { outcome: "completed" }));

    expect(board.get(ticket.id)?.status).toBe("needs_review");
    const moved = board.events(ticket.id).filter((event) => event.kind === "moved");
    expect(moved.map((event) => [event.actor, event.fromStatus, event.toStatus])).toEqual([
      ["agent", "running", "needs_review"],
    ]);
  });

  it("moves a ticket to Needs review while its turn waits for the person's answer", async () => {
    const { board, follow } = await harness();
    const ticket = await board.start({ agentId: "chief", title: "Pick a library" });

    follow(work("task-1", "running", { question: { text: "Which library should I use?" } }));
    expect(board.get(ticket.id)?.status).toBe("needs_review");
    follow(work("task-1", "running"));
    expect(board.get(ticket.id)?.status).toBe("running");
  });

  it("keeps a ticket Queued past the agent's limit and runs it when a slot frees", async () => {
    const { board, follow } = await harness("queued");
    const ticket = await board.start({ agentId: "chief", title: "Write the release notes" });
    expect(ticket.status).toBe("queued");

    follow(work("task-1", "queued", { hold: "task-limit" }));
    expect(board.get(ticket.id)?.status).toBe("queued");
    follow(work("task-1", "running"));
    expect(board.get(ticket.id)?.status).toBe("running");
  });

  it("puts a failed ticket back in Backlog with the failure line, and clears it on the next turn", async () => {
    const { board, follow } = await harness();
    const ticket = await board.start({ agentId: "chief", title: "Fix the login timeout" });

    follow(work("task-1", "idle", { outcome: "failed", error: "The provider  refused\nthe request." }));
    expect(board.get(ticket.id)).toMatchObject({ status: "backlog", error: "The provider refused the request." });

    follow(work("task-1", "running"));
    expect(board.get(ticket.id)).toMatchObject({ status: "running", error: null });

    follow(work("task-1", "idle", { outcome: "failed", error: null }));
    expect(board.get(ticket.id)).toMatchObject({
      status: "backlog",
      error: sourceText("error.agent.boardTickets.threadFailed"),
    });
  });

  it("puts a stopped ticket back in Backlog with the stopped line", async () => {
    const { board, follow } = await harness();
    const ticket = await board.start({ agentId: "chief", title: "Fix the login timeout" });

    follow(work("task-1", "idle", { outcome: "interrupted" }));

    expect(board.get(ticket.id)).toMatchObject({
      status: "backlog",
      error: sourceText("error.agent.boardTickets.threadStopped"),
    });
  });

  it("leaves a dragged ticket until the work changes, and keeps an approved ticket in Done", async () => {
    const { board, follow } = await harness();
    const ticket = await board.start({ agentId: "chief", title: "Fix the login timeout" });
    follow(work("task-1", "running"));

    board.move({ ticketId: ticket.id, status: "backlog" });
    follow(work("task-1", "running", { progress: "Checked 3 of 5 files" }));
    expect(board.get(ticket.id)?.status).toBe("backlog");

    follow(work("task-1", "idle", { outcome: "completed" }));
    expect(board.get(ticket.id)?.status).toBe("needs_review");
    board.move({ ticketId: ticket.id, status: "done" });
    follow(work("task-1", "queued"));
    follow(work("task-1", "idle", { outcome: "completed" }));
    expect(board.get(ticket.id)?.status).toBe("done");

    // A new turn is new work: the ticket leaves Done.
    follow(work("task-1", "running"));
    expect(board.get(ticket.id)?.status).toBe("running");
  });

  it("ignores a work thread without a ticket and a closed thread", async () => {
    const { board, follow } = await harness();
    const ticket = await board.start({ agentId: "chief", title: "Fix the login timeout" });

    follow(work("task-9", "idle", { outcome: "completed" }), work("task-1", "closed", { outcome: "completed" }));

    expect(board.get(ticket.id)?.status).toBe("running");
  });

  it("lets the agent post progress, comment and move only the ticket of its own thread", async () => {
    const { board } = await harness();
    const ticket = await board.start({ agentId: "chief", title: "Fix the login timeout" });

    const updated = board.updateForTask("task-1", {
      progress: "Opened the pull request",
      comment: "Ready for a look: the session lasts 30 minutes now.",
      status: "needs_review",
    });

    expect(updated).toMatchObject({ id: ticket.id, status: "needs_review", progress: "Opened the pull request" });
    const events = board.events(ticket.id);
    expect(events.find((event) => event.kind === "comment")).toMatchObject({
      actor: "agent",
      text: "Ready for a look: the session lasts 30 minutes now.",
    });
    expect(events.find((event) => event.kind === "moved")).toMatchObject({ actor: "agent", toStatus: "needs_review" });
    expect(board.updateForTask("task-2", { status: "backlog" })).toBeNull();
  });
});
