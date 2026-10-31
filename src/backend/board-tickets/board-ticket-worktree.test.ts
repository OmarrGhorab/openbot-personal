// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";

// Failure mode (#262): a ticket does not say which worktree and branch its agent works in, and Start
// gives the work thread no ticket title to name its branch from.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("starts a ticket with its title and shows its worktree and branch", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-worktree-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const titles: (string | undefined)[] = [];
  const board = new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async (_agentId, _text, ticket) => {
      titles.push(ticket?.title);
      return { id: "task-1", threadId: "thread-1", state: "running" };
    },
    worktreeOf: (taskId) => (taskId === "task-1" ? { path: "/repo/.openbot/worktrees/1", branch: "ticket/a-1" } : null),
  });
  const backlog = board.create({ title: "Fix sub", body: "Repo: /repo", status: "backlog", agentId: null });
  expect(board.get(backlog.id)?.worktree).toBeUndefined();
  const started = await board.start({ ticketId: backlog.id, agentId: "chief" });
  expect(titles).toEqual(["Fix sub"]);
  expect(started.worktree).toEqual({ path: "/repo/.openbot/worktrees/1", branch: "ticket/a-1" });
  expect(board.list()[0]?.worktree?.branch).toBe("ticket/a-1");
});

// #263: Start now on a ticket that a chat already took, or a double click on Start, made a second run.
it("keeps one run per ticket: Start on a running ticket opens that run", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-once-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  let starts = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const board = new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async () => {
      starts += 1;
      await gate;
      return { id: `task-${starts}`, threadId: `thread-${starts}`, state: "running" };
    },
  });
  const chat = board.create({ title: "Taken in chat", body: "", status: "backlog", agentId: null });
  board.bindChat(chat.id, "chief", "chief-thread");
  expect(board.get(chat.id)).toMatchObject({ status: "running", agentId: "chief", threadId: "chief-thread" });
  const reopened = await board.start({ ticketId: chat.id, agentId: "chief" });
  expect(reopened.threadId).toBe("chief-thread");
  expect(starts).toBe(0);

  const fresh = board.create({ title: "Double click", body: "", status: "backlog", agentId: null });
  const one = board.start({ ticketId: fresh.id, agentId: "chief" });
  await expect(board.start({ ticketId: fresh.id, agentId: "chief" })).rejects.toThrow();
  release();
  expect((await one).taskId).toBe("task-1");
  expect((await board.start({ ticketId: fresh.id, agentId: "chief" })).taskId).toBe("task-1");
  expect(starts).toBe(1);
});
