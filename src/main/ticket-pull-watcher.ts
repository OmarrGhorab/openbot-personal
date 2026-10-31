import { createOpenBotLogger } from "@openbot/logging";
import type { TicketPullPoller } from "../backend/agent-tickets/ticket-pull-poller";

const logger = createOpenBotLogger("ticket-pull-watcher");

/** How often the registered pull requests are read (ticket 244). */
const PULL_POLL_INTERVAL_MS = 2 * 60 * 1000;

interface TicketPullWatcherOptions {
  poller: TicketPullPoller;
  intervalMs?: number;
}

/**
 * Runs one pull request poll on a timer, as `AgentTicketWatcher` does for the intake. A pass that is
 * still running is not started again. The timer does not keep the app running. `stop` waits for a pass
 * in progress, so the GitHub token is not read after the connection stops.
 */
export class TicketPullWatcher {
  readonly #poller: TicketPullPoller;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #pass: Promise<void> | null = null;

  constructor(options: TicketPullWatcherOptions) {
    this.#poller = options.poller;
    this.#intervalMs = options.intervalMs ?? PULL_POLL_INTERVAL_MS;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
    this.#timer.unref();
  }

  tick(): Promise<void> {
    if (this.#pass) return this.#pass;
    this.#pass = this.#poller
      .poll()
      .then(() => undefined)
      .catch(() => {
        logger.warn("A pull request poll pass failed. The next pass tries again.");
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
