// Shared by migration v47 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// `autonomy_audit_log` records each autonomous action of an agent: an approval that the rules
// answered or that waited for the person, the stop of a turn at a budget limit, Stop all agents and
// its resume, and a change of a rule or a budget. `target` and `detail` hold text that has passed
// `redactAuditText`; a secret never reaches this table. Rows are never edited.
//
// `autonomy_turn_usage` keeps one row per finished turn: its work thread (`task_id`, null for the
// agent's own chat), its wall time, its tokens and its estimated cost (null when the provider's model
// has no price). A budget sums these rows, and adds the turns that run now. The rows are the
// evidence of what a budget counted, so they outlive the task and are not pruned.
export const AUTONOMY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS autonomy_audit_log (
    event_id INTEGER PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    action TEXT NOT NULL,
    agent_id TEXT,
    thread_id TEXT,
    task_id TEXT,
    risk TEXT CHECK(risk IS NULL OR risk IN ('low', 'medium', 'high')),
    result TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS autonomy_audit_log_agent ON autonomy_audit_log(agent_id, event_id);
  CREATE TABLE IF NOT EXISTS autonomy_turn_usage (
    turn_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    task_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
    tokens INTEGER NOT NULL CHECK(tokens >= 0),
    cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd >= 0)
  );
  CREATE INDEX IF NOT EXISTS autonomy_turn_usage_task ON autonomy_turn_usage(task_id, ended_at);
  CREATE INDEX IF NOT EXISTS autonomy_turn_usage_agent ON autonomy_turn_usage(agent_id, ended_at);
`;
