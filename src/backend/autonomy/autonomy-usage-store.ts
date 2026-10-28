import type { AgentUsageTotals } from "@openbot/contracts/ipc";
import { databaseRow, databaseRows, optionalNumberColumn, requiredNumberColumn } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/** One finished turn, as a budget counts it. `costUsd` is null when the model has no price. */
interface TurnUsageRecord {
  turnId: string;
  agentId: string;
  threadId: string;
  taskId: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  tokens: number;
  costUsd: number | null;
}

interface UsageTotalsQuery {
  agentId: string;
  /** Only the turns of this work thread. Absent: every turn of the agent, its chat and its tasks. */
  taskId?: string;
  /** Only the turns that ended at or after this ISO time. */
  since?: string;
}

/**
 * Owns `autonomy_turn_usage` (migration 47). A turn is recorded once, when it ends: `INSERT OR IGNORE`
 * keeps the first record of a turn that two paths end.
 */
export class AutonomyUsageStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  record(turn: TurnUsageRecord): void {
    this.#database.connection
      .prepare(
        `INSERT OR IGNORE INTO autonomy_turn_usage
          (turn_id, agent_id, thread_id, task_id, started_at, ended_at, duration_ms, tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turn.turnId,
        turn.agentId,
        turn.threadId,
        turn.taskId,
        turn.startedAt,
        turn.endedAt,
        Math.max(0, Math.round(turn.durationMs)),
        Math.max(0, Math.round(turn.tokens)),
        turn.costUsd,
      );
  }

  /** The sum of the finished turns that match. Cost is null when no matching turn had a price. */
  totals(query: UsageTotalsQuery): AgentUsageTotals {
    const conditions = ["agent_id = ?"];
    const values: Array<string> = [query.agentId];
    if (query.taskId !== undefined) {
      conditions.push("task_id = ?");
      values.push(query.taskId);
    }
    if (query.since !== undefined) {
      conditions.push("ended_at >= ?");
      values.push(query.since);
    }
    const row = databaseRow(
      this.#database.connection
        .prepare(
          `SELECT COALESCE(SUM(tokens), 0) AS tokens, COALESCE(SUM(duration_ms), 0) AS duration_ms,
                  SUM(cost_usd) AS cost_usd
           FROM autonomy_turn_usage WHERE ${conditions.join(" AND ")}`,
        )
        .get(...values),
    );
    if (!row) return { tokens: 0, minutes: 0, costUsd: null };
    return {
      tokens: requiredNumberColumn(row, "tokens"),
      minutes: requiredNumberColumn(row, "duration_ms") / 60_000,
      costUsd: optionalNumberColumn(row, "cost_usd"),
    };
  }

  /** The totals of every work thread of the agent, keyed by task id. */
  taskTotals(agentId: string): Map<string, AgentUsageTotals> {
    const rows = databaseRows(
      this.#database.connection
        .prepare(
          `SELECT task_id, SUM(tokens) AS tokens, SUM(duration_ms) AS duration_ms, SUM(cost_usd) AS cost_usd
           FROM autonomy_turn_usage WHERE agent_id = ? AND task_id IS NOT NULL GROUP BY task_id`,
        )
        .all(agentId),
    );
    const totals = new Map<string, AgentUsageTotals>();
    for (const row of rows) {
      const taskId = row.task_id;
      if (typeof taskId !== "string") continue;
      totals.set(taskId, {
        tokens: requiredNumberColumn(row, "tokens"),
        minutes: requiredNumberColumn(row, "duration_ms") / 60_000,
        costUsd: optionalNumberColumn(row, "cost_usd"),
      });
    }
    return totals;
  }
}
