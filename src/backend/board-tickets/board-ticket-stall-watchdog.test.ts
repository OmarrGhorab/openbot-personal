import type { AgentTask, BoardTicket } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { BoardTicketStallWatchdog } from "./board-ticket-stall-watchdog";

function task(progress: string, turn = "turn-1"): AgentTask {
  return Object.assign(Object.create(null), {
    id: "task-1",
    agentId: "builder",
    threadId: "thread-1",
    activeTurnId: turn,
    progress,
    updatedAt: "2026-10-31T00:00:00.000Z",
  });
}

function setup() {
  let clock = 0;
  const ticket: Pick<BoardTicket, "id" | "status" | "error"> = { id: "ticket-1", status: "running", error: null };
  const board = {
    forTask: vi.fn(() => Object.assign(Object.create(null), ticket)),
    patch: vi.fn((_id: string, patch: { error?: string | null }) => {
      ticket.error = patch.error ?? null;
    }),
    comment: vi.fn(),
    moveIfNeeded: vi.fn((_id: string, status: BoardTicket["status"]) => {
      ticket.status = status;
      return true;
    }),
  };
  const retry = vi.fn(async () => {});
  const watchdog = new BoardTicketStallWatchdog({
    board: Object.assign(board),
    retry,
    now: () => clock,
    stallMs: 1000,
    retryDelayMs: 100,
    retries: 2,
  });
  const snapshot = (value: AgentTask) => watchdog.notice(Object.assign({ tasks: [value] }));
  return { watchdog, board, retry, ticket, snapshot, tick: (ms: number) => (clock += ms) };
}

describe("ticket 266: a stalled ticket turn", () => {
  it("does nothing while the turn sends updates", async () => {
    const { watchdog, snapshot, tick, board } = setup();
    snapshot(task("a"));
    tick(900);
    snapshot(task("b"));
    tick(900);
    expect(await watchdog.check()).toEqual([]);
    expect(board.patch).not.toHaveBeenCalled();
  });

  it("shows Stalled, retries, and goes to Blocked after the limit", async () => {
    const { watchdog, snapshot, tick, board, retry, ticket } = setup();
    for (const attempt of [1, 2]) {
      snapshot(task("Reviewing the latest tool result", `turn-${attempt}`));
      tick(1000);
      await watchdog.check();
      expect(ticket.error).toContain(`Stalled`);
      expect(ticket.error).toContain(`(${attempt} of 2)`);
      tick(100);
      await watchdog.check();
      expect(retry).toHaveBeenCalledTimes(attempt);
      // The retry stops the turn; the new turn starts.
      snapshot(Object.assign(task(""), { activeTurnId: null }));
    }
    snapshot(task("Reviewing the latest tool result", "turn-3"));
    tick(1000);
    await watchdog.check();
    expect(ticket.error).toContain("Blocked");
    expect(ticket.status).toBe("backlog");
    expect(board.comment).toHaveBeenCalledTimes(3);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("leaves a ticket that is not running", async () => {
    const { watchdog, snapshot, tick, ticket, board } = setup();
    ticket.status = "needs_review";
    snapshot(task("a"));
    tick(5000);
    await watchdog.check();
    expect(board.patch).not.toHaveBeenCalled();
  });
});
