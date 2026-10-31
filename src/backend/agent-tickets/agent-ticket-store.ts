import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { databaseRow, databaseRows, requiredStringColumn } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";
import {
  type AgentTicketWatch,
  type AgentTicketWatchInput,
  TICKET_PROVIDERS,
  type TicketProvider,
  validateTicketWatchInput,
} from "./agent-ticket-watch";

/**
 * Owns `projection_agent_ticket_watches` and `projection_agent_ticket_links` (migration 49). It never
 * imports the database facade's callers.
 *
 * A link is written before the task starts, so two polls that race cannot start one ticket twice:
 * the primary key lets only one insert win. A link whose task is missing keeps its key, so a deleted
 * work thread does not start again on the next poll.
 */
export class AgentTicketStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  /** The watch of the agent, or null when it has none. */
  watch(agentId: string): AgentTicketWatch | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT * FROM projection_agent_ticket_watches WHERE agent_id = ?")
        .get(agentId),
    );
    return row ? decodeWatch(row) : null;
  }

  /** The watches that the intake polls: every enabled one. */
  enabledWatches(): AgentTicketWatch[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT * FROM projection_agent_ticket_watches WHERE enabled = 1 ORDER BY agent_id")
        .all(),
    ).map(decodeWatch);
  }

  /** Creates the watch of the agent, or replaces its source. The first creation time is kept. */
  setWatch(agentId: string, watchInput: AgentTicketWatchInput, enabled: boolean): AgentTicketWatch {
    const input = validateTicketWatchInput(watchInput);
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO projection_agent_ticket_watches
           (agent_id, provider, project, label, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET
           provider = excluded.provider,
           project = excluded.project,
           label = excluded.label,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(agentId, input.provider, input.project, input.label, enabled ? 1 : 0, now, now);
    const watch = this.watch(agentId);
    if (!watch) throw new Error("The ticket watch was not stored.");
    return watch;
  }

  /** Removes the watch. The links stay, so the tickets it started do not start again. */
  removeWatch(agentId: string): void {
    this.#database.connection.prepare("DELETE FROM projection_agent_ticket_watches WHERE agent_id = ?").run(agentId);
  }

  /**
   * Reserves a ticket for the agent. True when this call made the reservation, false when the ticket
   * was already started or is being started.
   */
  reserve(agentId: string, provider: TicketProvider, ticketKey: string): boolean {
    const result = this.#database.connection
      .prepare(
        `INSERT INTO projection_agent_ticket_links (agent_id, provider, ticket_key, task_id, created_at)
         VALUES (?, ?, ?, NULL, ?)
         ON CONFLICT(agent_id, provider, ticket_key) DO NOTHING`,
      )
      .run(agentId, provider, ticketKey, new Date().toISOString());
    return result.changes === 1;
  }

  /** Stores the work thread of a reserved ticket. */
  attachTask(agentId: string, provider: TicketProvider, ticketKey: string, taskId: string): void {
    this.#database.connection
      .prepare(
        "UPDATE projection_agent_ticket_links SET task_id = ? WHERE agent_id = ? AND provider = ? AND ticket_key = ?",
      )
      .run(taskId, agentId, provider, ticketKey);
  }

  /** Drops a reservation whose start failed, so the next poll tries the ticket again. */
  release(agentId: string, provider: TicketProvider, ticketKey: string): void {
    this.#database.connection
      .prepare(
        "DELETE FROM projection_agent_ticket_links WHERE agent_id = ? AND provider = ? AND ticket_key = ? AND task_id IS NULL",
      )
      .run(agentId, provider, ticketKey);
  }

  /** The work thread that started the ticket, or null when it has none. */
  taskIdForTicket(agentId: string, provider: TicketProvider, ticketKey: string): string | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          "SELECT task_id FROM projection_agent_ticket_links WHERE agent_id = ? AND provider = ? AND ticket_key = ?",
        )
        .get(agentId, provider, ticketKey),
    );
    if (!row) return null;
    const taskId = row.task_id;
    return typeof taskId === "string" ? taskId : null;
  }

  /** The ticket that a work thread started, or null when the thread is not a ticket thread. */
  ticketForTask(taskId: string): { agentId: string; provider: TicketProvider; ticketKey: string } | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT agent_id, provider, ticket_key FROM projection_agent_ticket_links WHERE task_id = ?")
        .get(taskId),
    );
    if (!row) return null;
    const provider = requiredStringColumn(row, "provider");
    if (!isOneOf(TICKET_PROVIDERS, provider)) throw new Error(`Unknown ticket provider: ${provider}`);
    return {
      agentId: requiredStringColumn(row, "agent_id"),
      provider,
      ticketKey: requiredStringColumn(row, "ticket_key"),
    };
  }

  /**
   * Gives a pull request to a work thread. False when another work thread owns it already. The
   * project is compared in lower case, as GitHub compares repository names.
   */
  ownPull(input: {
    agentId: string;
    taskId: string;
    provider: TicketProvider;
    project: string;
    pullNumber: number;
    ticketKey: string;
  }): boolean {
    const now = new Date().toISOString();
    const result = this.#database.connection
      .prepare(
        `INSERT INTO projection_agent_ticket_pulls
           (provider, project, pull_number, agent_id, task_id, ticket_key, failed_fixes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(provider, project, pull_number) DO NOTHING`,
      )
      .run(
        input.provider,
        input.project.toLowerCase(),
        input.pullNumber,
        input.agentId,
        input.taskId,
        input.ticketKey,
        now,
        now,
      );
    return result.changes === 1;
  }

  /** The work thread that owns a pull request, with its ticket and its failed fixes, or null. */
  pullOwner(provider: TicketProvider, project: string, pullNumber: number): TicketPullOwner | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          "SELECT agent_id, task_id, ticket_key, failed_fixes FROM projection_agent_ticket_pulls WHERE provider = ? AND project = ? AND pull_number = ?",
        )
        .get(provider, project.toLowerCase(), pullNumber),
    );
    if (!row) return null;
    const failedFixes = row.failed_fixes;
    if (typeof failedFixes !== "number") throw new Error("Invalid SQLite column failed_fixes.");
    return {
      agentId: requiredStringColumn(row, "agent_id"),
      taskId: requiredStringColumn(row, "task_id"),
      ticketKey: requiredStringColumn(row, "ticket_key"),
      failedFixes,
    };
  }

  /** Stores the count of failed fixes of a pull request. */
  setFailedFixes(provider: TicketProvider, project: string, pullNumber: number, failedFixes: number): void {
    this.#database.connection
      .prepare(
        "UPDATE projection_agent_ticket_pulls SET failed_fixes = ?, updated_at = ? WHERE provider = ? AND project = ? AND pull_number = ?",
      )
      .run(failedFixes, new Date().toISOString(), provider, project.toLowerCase(), pullNumber);
  }

  /** The pull requests of a provider that the pull request poller reads (ticket 244). */
  polledPulls(provider: TicketProvider): TicketPolledPull[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          "SELECT project, pull_number, ci_state, checked_sha, review_cursor FROM projection_agent_ticket_pulls WHERE provider = ? ORDER BY created_at",
        )
        .all(provider),
    ).map((row) => ({
      project: requiredStringColumn(row, "project"),
      pullNumber: Number(row.pull_number),
      ciState: ciStateColumn(row.ci_state),
      checkedSha: typeof row.checked_sha === "string" ? row.checked_sha : null,
      reviewCursor: typeof row.review_cursor === "number" ? row.review_cursor : null,
    }));
  }

  /** Stores what the poller read about a pull request. A field that is absent keeps its value. */
  setPullPoll(
    provider: TicketProvider,
    project: string,
    pullNumber: number,
    patch: { ciState?: TicketCiState | null; checkedSha?: string; reviewCursor?: number },
  ): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.ciState !== undefined) {
      sets.push("ci_state = ?");
      values.push(patch.ciState);
    }
    if (patch.checkedSha !== undefined) {
      sets.push("checked_sha = ?");
      values.push(patch.checkedSha);
    }
    if (patch.reviewCursor !== undefined) {
      sets.push("review_cursor = ?");
      values.push(patch.reviewCursor);
    }
    if (sets.length === 0) return;
    this.#database.connection
      .prepare(
        `UPDATE projection_agent_ticket_pulls SET ${sets.join(", ")}, updated_at = ? WHERE provider = ? AND project = ? AND pull_number = ?`,
      )
      .run(...values, new Date().toISOString(), provider, project.toLowerCase(), pullNumber);
  }

  /** The newest pull request of a work thread with its CI state, or null. The ticket detail shows it. */
  pullForTask(taskId: string): { project: string; pullNumber: number; ciState: TicketCiState | null } | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          "SELECT project, pull_number, ci_state FROM projection_agent_ticket_pulls WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(taskId),
    );
    if (!row) return null;
    return {
      project: requiredStringColumn(row, "project"),
      pullNumber: Number(row.pull_number),
      ciState: ciStateColumn(row.ci_state),
    };
  }
}

/** The CI state of a pull request, as the poller last read it. */
export type TicketCiState = "pending" | "failed" | "passed";
const TICKET_CI_STATES = ["pending", "failed", "passed"] as const;

function ciStateColumn(value: unknown): TicketCiState | null {
  return typeof value === "string" && isOneOf(TICKET_CI_STATES, value) ? value : null;
}

/** A pull request that the poller reads, with what it gave to the work thread last time. */
export interface TicketPolledPull {
  project: string;
  pullNumber: number;
  ciState: TicketCiState | null;
  /** The head commit whose final CI result the work thread already has. */
  checkedSha: string | null;
  /** The highest review comment ID that the work thread already has. */
  reviewCursor: number | null;
}

/** The work thread that owns a pull request. `failedFixes` counts CI failures since the last passing check. */
export interface TicketPullOwner {
  agentId: string;
  taskId: string;
  ticketKey: string;
  failedFixes: number;
}

function decodeWatch(row: DynamicRecord): AgentTicketWatch {
  const provider = requiredStringColumn(row, "provider");
  if (!isOneOf(TICKET_PROVIDERS, provider)) throw new Error(`Unknown ticket provider: ${provider}`);
  const enabled = row.enabled;
  if (enabled !== 0 && enabled !== 1) throw new Error("Invalid SQLite column enabled.");
  return {
    agentId: requiredStringColumn(row, "agent_id"),
    provider,
    project: requiredStringColumn(row, "project"),
    label: requiredStringColumn(row, "label"),
    enabled: enabled === 1,
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
}
