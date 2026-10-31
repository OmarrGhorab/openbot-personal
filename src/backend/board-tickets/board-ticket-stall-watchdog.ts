import type { AgentTask, AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import type { BoardTicketService } from "./board-ticket-service";

const logger = createOpenBotLogger("board-tickets");

/** How long a ticket's running turn may go with no update before it counts as stalled (ticket 266). */
export const TICKET_STALL_MS = 4 * 60_000;
/** How long a stalled ticket shows Stalled before the watchdog retries its turn. */
export const TICKET_STALL_RETRY_DELAY_MS = 30_000;
/** How many times a stalled turn is retried before its ticket goes to Blocked. */
export const TICKET_STALL_RETRIES = 2;

export interface BoardTicketStallWatchdogOptions {
  board: Pick<BoardTicketService, "forTask" | "patch" | "comment" | "moveIfNeeded">;
  /** Stops the stalled turn and sends the task a message that asks it to go on. */
  retry: (task: AgentTask) => Promise<void>;
  now?: () => number;
  stallMs?: number;
  retryDelayMs?: number;
  retries?: number;
}

interface Watch {
  task: AgentTask;
  /** What the turn looked like at its last update: its id, its progress line and its update time. */
  signature: string;
  changedAt: number;
  /** When the ticket was marked Stalled for this signature, or null. */
  stalledAt: number | null;
}

/**
 * Watches the running turn of each ticket's work thread (ticket 266). A turn that sends no update for
 * `stallMs` marks its ticket Stalled; after `retryDelayMs` the turn is stopped and asked to go on, up to
 * `retries` times. After that the ticket goes to Backlog as Blocked with the reason as a comment. An
 * update of the turn, or a new turn, clears the watch.
 */
export class BoardTicketStallWatchdog {
  readonly #options: Required<Omit<BoardTicketStallWatchdogOptions, "board" | "retry">> &
    Pick<BoardTicketStallWatchdogOptions, "board" | "retry">;
  readonly #watches = new Map<string, Watch>();
  /** Retries used per task, kept until a turn of the task ends on its own. */
  readonly #retried = new Map<string, number>();
  /** Tasks the watchdog stopped itself, so their stop does not reset the retry count. */
  readonly #retrying = new Set<string>();

  constructor(options: BoardTicketStallWatchdogOptions) {
    this.#options = {
      now: Date.now,
      stallMs: TICKET_STALL_MS,
      retryDelayMs: TICKET_STALL_RETRY_DELAY_MS,
      retries: TICKET_STALL_RETRIES,
      ...options,
    };
  }

  notice(snapshot: AgentTasksSnapshot): void {
    for (const task of snapshot.tasks) {
      if (!task.activeTurnId) {
        this.#watches.delete(task.id);
        if (!this.#retrying.has(task.id)) this.#retried.delete(task.id);
        continue;
      }
      this.#retrying.delete(task.id);
      const signature = `${task.activeTurnId}|${task.progress ?? ""}|${task.updatedAt}`;
      const watch = this.#watches.get(task.id);
      if (watch?.signature === signature) continue;
      this.#watches.set(task.id, { task, signature, changedAt: this.#options.now(), stalledAt: null });
    }
  }

  /** Runs on a timer. Returns the task ids it acted on, for tests. */
  async check(): Promise<string[]> {
    const now = this.#options.now();
    const acted: string[] = [];
    for (const watch of [...this.#watches.values()]) {
      if (now - watch.changedAt < this.#options.stallMs) continue;
      const ticket = this.#options.board.forTask(watch.task.id);
      if (ticket?.status !== "running") continue;
      const minutes = Math.round((now - watch.changedAt) / 60_000);
      const used = this.#retried.get(watch.task.id) ?? 0;
      try {
        if (watch.stalledAt === null) {
          watch.stalledAt = now;
          const text =
            used < this.#options.retries
              ? sourceText("error.agent.boardTickets.stalled", {
                  minutes: String(minutes),
                  attempt: String(used + 1),
                  limit: String(this.#options.retries),
                })
              : sourceText("error.agent.boardTickets.stalledBlocked", {
                  minutes: String(minutes),
                  limit: String(this.#options.retries),
                });
          this.#options.board.patch(ticket.id, { error: text }, "agent");
          this.#options.board.comment({ ticketId: ticket.id, text }, "agent");
          if (used >= this.#options.retries) {
            this.#options.board.moveIfNeeded(ticket.id, "backlog", "agent", text);
            this.#watches.delete(watch.task.id);
          }
          acted.push(watch.task.id);
          continue;
        }
        if (now - watch.stalledAt < this.#options.retryDelayMs) continue;
        this.#retried.set(watch.task.id, used + 1);
        this.#retrying.add(watch.task.id);
        this.#watches.delete(watch.task.id);
        await this.#options.retry(watch.task);
        acted.push(watch.task.id);
      } catch (error) {
        logger.warn("Could not handle a stalled ticket turn.", {
          taskId: watch.task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return acted;
  }
}
