import { createOpenBotLogger } from "@openbot/logging";
import type { AgentTicketIntake } from "../backend/agent-tickets/agent-ticket-intake";
import { runCauseEffect } from "../backend/effect-boundary";

const logger = createOpenBotLogger("agent-ticket-watcher");

/** How often the ticket intake polls the watched repositories. */
const TICKET_POLL_INTERVAL_MS = 5 * 60 * 1000;

interface AgentTicketWatcherOptions {
  intake: AgentTicketIntake;
  intervalMs?: number;
}

/**
 * Runs one ticket intake pass on a timer. A pass that is still running is not started again, so a
 * slow GitHub call never stacks passes. The timer is unreferenced: it does not keep the app running.
 *
 * `stop` waits for a pass in progress, so the GitHub token is not read after the connection stops.
 */
export class AgentTicketWatcher {
  readonly #intake: AgentTicketIntake;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #pass: Promise<void> | null = null;

  constructor(options: AgentTicketWatcherOptions) {
    this.#intake = options.intake;
    this.#intervalMs = options.intervalMs ?? TICKET_POLL_INTERVAL_MS;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
    this.#timer.unref();
  }

  /** One pass now, unless a pass is already running; then that pass is returned. */
  tick(): Promise<void> {
    if (this.#pass) return this.#pass;
    this.#pass = runCauseEffect(this.#intake.poll())
      .catch(() => {
        logger.warn("A ticket intake pass failed. The next pass tries again.");
      })
      .finally(() => {
        this.#pass = null;
      });
    return this.#pass;
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#pass;
  }
}
