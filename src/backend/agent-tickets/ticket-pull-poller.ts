import { createOpenBotLogger } from "@openbot/logging";
import type { Effect } from "effect";
import { runCauseEffect } from "../effect-boundary";
import { isRecord } from "../protocol";
import type { TicketIntakeFailed } from "./agent-ticket-intake";
import type { AgentTicketStore, TicketCiState, TicketPolledPull } from "./agent-ticket-store";
import type { TicketPullEvent, TicketPullOutcome } from "./ticket-pull-events";

const logger = createOpenBotLogger("agent-ticket-pull-poller");

const GITHUB_API_URL = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
/** How much of the failure text goes to the work thread. */
const SUMMARY_LIMIT = 2000;
/** Check results that count as a failure. "neutral" and "skipped" do not fail a pull request. */
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
const FAILED_STATUSES = new Set(["failure", "error"]);

type TicketPullPollFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface TicketPullPollerOptions {
  store: AgentTicketStore;
  /** The user's GitHub token, or null when GitHub is not connected. Read at each pass. */
  accessToken: () => Promise<string | null>;
  fetch: TicketPullPollFetch;
  /** Gives one event to the work thread that owns the pull request (`TicketPullEvents.handle`). */
  handle: (event: TicketPullEvent) => Effect.Effect<TicketPullOutcome, TicketIntakeFailed>;
  /** The REST API root. The default is GitHub's API; a check points it at a local server. */
  apiUrl?: string;
}

/** What one pass did. The e2e check reads it. */
export interface TicketPullPollReport {
  pulls: number;
  delivered: TicketPullEvent["kind"][];
}

/**
 * Ticket 244: reads the check runs, the commit statuses and the review comments of each pull request
 * that a work thread registered, and gives each new event to the handler once. It makes no model call.
 *
 * A CI result is given when no check is pending, once for each head commit (`checked_sha`). A new
 * push gives a new head commit, so its result is given again. A review comment is given once: the
 * poller keeps the highest comment ID (`review_cursor`). Comments of the connected GitHub user are
 * not given, because the agent writes with that user. The state is stored after the handler accepts
 * the event, so a failed delivery is tried again on the next pass and a delivered one is not.
 */
export class TicketPullPoller {
  readonly #options: TicketPullPollerOptions;
  readonly #api: string;

  constructor(options: TicketPullPollerOptions) {
    this.#options = options;
    this.#api = options.apiUrl ?? GITHUB_API_URL;
  }

  async poll(): Promise<TicketPullPollReport> {
    const report: TicketPullPollReport = { pulls: 0, delivered: [] };
    const pulls = this.#options.store.polledPulls("github");
    if (pulls.length === 0) return report;
    const token = await this.#options.accessToken();
    if (!token) return report;
    const self = await this.#get(token, "/user").catch(() => null);
    const login = isRecord(self) && typeof self.login === "string" ? self.login.toLowerCase() : null;
    for (const pull of pulls) {
      report.pulls += 1;
      try {
        await this.#pollPull(token, login, pull, report);
      } catch {
        // The error has no token and no response body in it.
        logger.warn("A pull request poll failed. The next pass tries again.", {
          pull: `${pull.project}#${pull.pullNumber}`,
        });
      }
    }
    return report;
  }

  async #pollPull(token: string, login: string | null, pull: TicketPolledPull, report: TicketPullPollReport) {
    const { store, handle } = this.#options;
    const base = `/repos/${pull.project}`;
    const info = await this.#get(token, `${base}/pulls/${pull.pullNumber}`);
    if (!isRecord(info) || info.state !== "open" || !isRecord(info.head) || typeof info.head.sha !== "string") return;
    const sha = info.head.sha;
    const url = typeof info.html_url === "string" ? info.html_url : "";
    const ci = await this.#ci(token, base, sha);
    if (ci.state !== pull.ciState) store.setPullPoll("github", pull.project, pull.pullNumber, { ciState: ci.state });

    if (ci.state !== "pending" && pull.checkedSha !== sha) {
      const event: TicketPullEvent =
        ci.state === "failed"
          ? {
              kind: "check-failed",
              provider: "github",
              project: pull.project,
              pullNumber: pull.pullNumber,
              summary: ci.failures.join("\n").slice(0, SUMMARY_LIMIT),
              url,
            }
          : { kind: "check-passed", provider: "github", project: pull.project, pullNumber: pull.pullNumber };
      await runCauseEffect(handle(event));
      store.setPullPoll("github", pull.project, pull.pullNumber, { checkedSha: sha });
      report.delivered.push(event.kind);
    }

    const comments = await this.#get(token, `${base}/pulls/${pull.pullNumber}/comments?per_page=100`);
    if (!Array.isArray(comments)) return;
    const cursor = pull.reviewCursor ?? 0;
    const fresh = comments
      .filter(isRecord)
      .filter((comment) => typeof comment.id === "number" && comment.id > cursor)
      .sort((a, b) => Number(a.id) - Number(b.id));
    for (const comment of fresh) {
      const id = Number(comment.id);
      const author = isRecord(comment.user) && typeof comment.user.login === "string" ? comment.user.login : "";
      if (author && author.toLowerCase() !== login) {
        const event: TicketPullEvent = {
          kind: "review-comment",
          provider: "github",
          project: pull.project,
          pullNumber: pull.pullNumber,
          author,
          text: typeof comment.body === "string" ? comment.body : "",
          url: typeof comment.html_url === "string" ? comment.html_url : url,
        };
        await runCauseEffect(handle(event));
        report.delivered.push(event.kind);
      }
      store.setPullPoll("github", pull.project, pull.pullNumber, { reviewCursor: id });
    }
  }

  /** The CI state of a commit from its check runs and its commit statuses. No check yet is pending. */
  async #ci(token: string, base: string, sha: string): Promise<{ state: TicketCiState; failures: string[] }> {
    const runs = await this.#get(token, `${base}/commits/${sha}/check-runs?per_page=100`);
    const status = await this.#get(token, `${base}/commits/${sha}/status`);
    const failures: string[] = [];
    let pending = false;
    let total = 0;
    const checkRuns = isRecord(runs) && Array.isArray(runs.check_runs) ? runs.check_runs.filter(isRecord) : [];
    for (const run of checkRuns) {
      total += 1;
      const name = typeof run.name === "string" ? run.name : "check";
      if (run.status !== "completed") pending = true;
      else if (typeof run.conclusion === "string" && FAILED_CONCLUSIONS.has(run.conclusion)) {
        const title = isRecord(run.output) && typeof run.output.title === "string" ? `: ${run.output.title}` : "";
        failures.push(`${name} (${run.conclusion})${title}`);
      }
    }
    const statuses = isRecord(status) && Array.isArray(status.statuses) ? status.statuses.filter(isRecord) : [];
    for (const item of statuses) {
      total += 1;
      const name = typeof item.context === "string" ? item.context : "status";
      if (item.state === "pending") pending = true;
      else if (typeof item.state === "string" && FAILED_STATUSES.has(item.state)) {
        const text = typeof item.description === "string" ? `: ${item.description}` : "";
        failures.push(`${name} (${item.state})${text}`);
      }
    }
    if (pending || total === 0) return { state: "pending", failures };
    return { state: failures.length > 0 ? "failed" : "passed", failures };
  }

  async #get(token: string, path: string): Promise<unknown> {
    const response = await this.#options.fetch(`${this.#api}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    return response.json();
  }
}
