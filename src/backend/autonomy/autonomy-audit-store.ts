import {
  ACTION_RISK_LEVELS,
  type ActionRiskLevel,
  AUTONOMY_AUDIT_ACTIONS,
  AUTONOMY_AUDIT_RESULTS,
  type AutonomyAuditAction,
  type AutonomyAuditEntry,
  type AutonomyAuditFilter,
  type AutonomyAuditPage,
  type AutonomyAuditResult,
  MAX_AUDIT_PAGE_SIZE,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import {
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";
import { redactAuditText } from "./audit-redaction";

export interface AutonomyAuditInput {
  action: AutonomyAuditAction;
  agentId?: string | null;
  threadId?: string | null;
  taskId?: string | null;
  risk?: ActionRiskLevel | null;
  result: AutonomyAuditResult;
  /** The command, file or setting that the action touched. Redacted before it is stored. */
  target: string;
  /** A reason or a change summary. Redacted before it is stored. */
  detail?: string;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Owns `autonomy_audit_log` (migration 47). Every text is redacted here, on the way in, so a caller
 * cannot store a secret by passing the wrong argument. Rows are only added; nothing edits them.
 */
export class AutonomyAuditStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  record(input: AutonomyAuditInput, occurredAt: string = new Date().toISOString()): void {
    this.#database.connection
      .prepare(
        `INSERT INTO autonomy_audit_log (occurred_at, action, agent_id, thread_id, task_id, risk, result, target, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        occurredAt,
        input.action,
        input.agentId ?? null,
        input.threadId ?? null,
        input.taskId ?? null,
        input.risk ?? null,
        input.result,
        redactAuditText(input.target),
        redactAuditText(input.detail ?? ""),
      );
  }

  /** One page of rows, newest first. `before` is the event id of the last row of the previous page. */
  list(filter: AutonomyAuditFilter): AutonomyAuditPage {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (filter.agentId !== undefined) {
      conditions.push("agent_id = ?");
      values.push(filter.agentId);
    }
    if (filter.action !== undefined) {
      conditions.push("action = ?");
      values.push(filter.action);
    }
    if (filter.risk !== undefined) {
      conditions.push("risk = ?");
      values.push(filter.risk);
    }
    if (filter.before !== undefined) {
      conditions.push("event_id < ?");
      values.push(filter.before);
    }
    const limit = Math.min(filter.limit ?? DEFAULT_PAGE_SIZE, MAX_AUDIT_PAGE_SIZE);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = databaseRows(
      this.#database.connection
        .prepare(`SELECT * FROM autonomy_audit_log ${where} ORDER BY event_id DESC LIMIT ?`)
        .all(...values, limit + 1),
    );
    const entries = rows.slice(0, limit).map(decodeAuditRow);
    const last = entries.at(-1);
    return { entries, nextBefore: rows.length > limit && last ? last.eventId : null };
  }
}

function decodeAuditRow(row: DynamicRecord): AutonomyAuditEntry {
  const action = requiredStringColumn(row, "action");
  const result = requiredStringColumn(row, "result");
  const risk = optionalStringColumn(row, "risk");
  // A row the schema accepts but this version does not know is a corrupt row, not a value to pass on.
  if (!isOneOf(AUTONOMY_AUDIT_ACTIONS, action) || !isOneOf(AUTONOMY_AUDIT_RESULTS, result))
    throw new Error("autonomy_audit_log holds an unknown action or result.");
  if (risk !== null && !isOneOf(ACTION_RISK_LEVELS, risk)) throw new Error("autonomy_audit_log holds an unknown risk.");
  return {
    eventId: requiredNumberColumn(row, "event_id"),
    occurredAt: requiredStringColumn(row, "occurred_at"),
    action,
    agentId: optionalStringColumn(row, "agent_id"),
    threadId: optionalStringColumn(row, "thread_id"),
    taskId: optionalStringColumn(row, "task_id"),
    risk,
    result,
    target: requiredStringColumn(row, "target"),
    detail: requiredStringColumn(row, "detail"),
  };
}
