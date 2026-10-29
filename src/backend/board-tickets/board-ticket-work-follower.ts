import {
  type AgentTask,
  type AgentTasksSnapshot,
  BOARD_TICKET_ERROR_LIMIT,
  type BoardTicketStatus,
  type BoardTicketWorkFailure,
  boardTicketWorkStep,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import type { BoardTicketService } from "./board-ticket-service";

const logger = createOpenBotLogger("board-tickets");

/**
 * Moves the ticket of each work thread as its work goes, so nobody has to move a card: Running while a
 * turn runs, Queued while its message waits for a slot of the agent, Needs review when the turn asks a
 * question or completes, and back to Backlog with a failure line when a turn fails or is stopped. The
 * composition root hands it every `agent-tasks-changed` snapshot.
 *
 * It acts only when the column that a thread asks for changes, so a card that the person dragged stays
 * where they put it until the thread's work changes again. A Done ticket leaves Done only when its
 * thread runs a new turn: Done is the person's approval.
 *
 * It owns no table: it reads and writes through `BoardTicketService`.
 */
export class BoardTicketWorkFollower {
  readonly #board: BoardTicketService;
  /** The column that each work thread last asked for, by task id. */
  readonly #asked = new Map<string, BoardTicketStatus>();

  constructor(board: BoardTicketService) {
    this.#board = board;
  }

  follow(snapshot: AgentTasksSnapshot): void {
    for (const task of snapshot.tasks) {
      try {
        this.#followTask(task);
      } catch (error) {
        logger.warn("Could not move the ticket of a work thread.", {
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  #followTask(task: AgentTask): void {
    const step = boardTicketWorkStep(task);
    if (!step) {
      if (task.state === "closed") this.#asked.delete(task.id);
      return;
    }
    // Most snapshots change only a progress line: they ask for the same column and read nothing.
    if (this.#asked.get(task.id) === step.status) return;
    const ticket = this.#board.forTask(task.id);
    if (!ticket) return;
    this.#asked.set(task.id, step.status);
    if (ticket.status === "done" && step.status !== "running") return;
    const error = step.failure === null ? null : failureLine(task, step.failure);
    // A failure line stays until the next turn runs.
    if (error !== ticket.error && (error !== null || step.status === "running")) {
      this.#board.patch(ticket.id, { error }, "agent");
    }
    this.#board.moveIfNeeded(ticket.id, step.status, "agent", error);
  }
}

function failureLine(task: AgentTask, failure: BoardTicketWorkFailure): string {
  if (failure === "stopped") return sourceText("error.agent.boardTickets.threadStopped");
  const reported = task.error?.replace(/\s+/gu, " ").trim();
  return (reported || sourceText("error.agent.boardTickets.threadFailed")).slice(0, BOARD_TICKET_ERROR_LIMIT);
}
