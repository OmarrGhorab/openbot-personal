// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardTicketPhaseSteps } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { updateTicketToolSchema } from "../agent-tasks/agent-tasks";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";

// Failure modes of ticket 237: the agent cannot say which step it is in, so the board shows nothing; it
// changes a type the person chose; a repeated phase floods the activity; the tool takes a made-up phase.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function harness() {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-phase-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  return new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async () => ({ id: "task-1", threadId: "thread-1", state: "running" }),
  });
}

describe("ticket phase, type and error from the agent", () => {
  it("stores the phase, records one event per change, and sets an unchosen type and the error", async () => {
    const board = await harness();
    const ticket = await board.start({ agentId: "chief", title: "Polish the header" });

    board.updateForTask("task-1", { phase: "triage" });
    board.updateForTask("task-1", { phase: "triage" });
    const updated = board.updateForTask("task-1", { phase: "reproduce", type: "bug", error: "Tests failed: 2" });

    expect(updated).toMatchObject({ phase: "reproduce", type: "bug", typeSource: "agent", error: "Tests failed: 2" });
    const phases = board.events(ticket.id).filter((event) => event.kind === "phase");
    expect(phases.map((event) => [event.actor, event.text])).toEqual([
      ["agent", "triage"],
      ["agent", "reproduce"],
    ]);
  });

  it("never changes a type the person chose", async () => {
    const board = await harness();
    const created = board.create({ title: "Fix sub", type: "feature", agentId: "chief" });
    const ticket = await board.start({ ticketId: created.id, agentId: "chief" });

    board.updateForTask("task-1", { type: "chore" });

    expect(board.get(ticket.id)).toMatchObject({ type: "feature", typeSource: "user" });
  });

  it("starts a chat take in its own work thread, Running, in the take phase (ticket 238)", async () => {
    const board = await harness();
    const created = board.create({ title: "Checkout fails" });

    const started = await board.startFromChat(created.id, "chief", "brief");

    expect(started).toMatchObject({
      taskId: "task-1",
      threadId: "thread-1",
      agentId: "chief",
      status: "running",
      phase: "take",
    });
  });

  it("checks the tool input and shows Reproduce only for bugs", () => {
    expect(updateTicketToolSchema.safeParse({ phase: "implement", type: "bug" }).success).toBe(true);
    expect(updateTicketToolSchema.safeParse({ phase: "ship-it" }).success).toBe(false);
    expect(boardTicketPhaseSteps("bug")).toContain("reproduce");
    expect(boardTicketPhaseSteps("feature")).not.toContain("reproduce");
    expect(boardTicketPhaseSteps(null)).toHaveLength(7);
  });
});
