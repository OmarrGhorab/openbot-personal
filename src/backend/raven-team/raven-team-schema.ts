// Shared by migration v48 and the separate new-database schema. IF NOT EXISTS throughout, because this
// text is both the migration and the tail of the latest schema.
//
// These tables are the source of truth of a Raven Stack team on this computer. Nothing is sent to a
// remote host. A template row holds a user's copy of the team: the built-in template is code, so it has
// no row. A job row holds one run: its brief, its state, the head commit and the fix-round count. A role
// row holds one role of one job: its agent, its work thread, its model at the start, and its last
// report. `pending_message` holds the last handoff that the runtime sent and that no turn has started
// yet, so a stop or a restart can send it again.
//
// Role rows are kept per job: changing a template after a start does not change a running job.
export const RAVEN_TEAM_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS raven_team_templates (
    template_id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
    roles_json TEXT NOT NULL CHECK(JSON_VALID(roles_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS raven_team_jobs (
    job_id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    brief TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('running', 'stopped', 'waiting-user', 'done', 'not-done')),
    head_commit TEXT,
    fix_rounds INTEGER NOT NULL DEFAULT 0 CHECK(fix_rounds >= 0),
    question_json TEXT CHECK(question_json IS NULL OR JSON_VALID(question_json)),
    fallback_model TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS raven_team_roles (
    job_id TEXT NOT NULL REFERENCES raven_team_jobs(job_id) ON DELETE CASCADE,
    role_id TEXT NOT NULL,
    label TEXT NOT NULL,
    skills_json TEXT NOT NULL CHECK(JSON_VALID(skills_json)),
    agent_id TEXT,
    task_id TEXT,
    thread_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    access TEXT NOT NULL CHECK(access IN ('read-only', 'write')),
    state TEXT NOT NULL CHECK(state IN ('waiting', 'working', 'reported', 'passed', 'failed', 'blocked', 'stopped')),
    verdict TEXT CHECK(verdict IS NULL OR verdict IN ('DONE', 'PASS', 'PASS+NOTES', 'FAIL', 'BLOCKED')),
    score INTEGER CHECK(score IS NULL OR score BETWEEN 0 AND 10),
    commit_sha TEXT,
    fails INTEGER NOT NULL DEFAULT 0 CHECK(fails >= 0),
    reminders INTEGER NOT NULL DEFAULT 0 CHECK(reminders >= 0),
    pending_message TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (job_id, role_id)
  );
  CREATE INDEX IF NOT EXISTS raven_team_roles_thread ON raven_team_roles(thread_id);
  CREATE INDEX IF NOT EXISTS raven_team_jobs_updated ON raven_team_jobs(updated_at);
`;

// Migration 53 (Autopilot) and the tail of the latest schema. `decision_json` holds what Autopilot chose
// for a job (`RavenAutopilotDecision`: stack, template, playbook, models, the reason and every later
// switch); null for a job that the person started from the team page. `round_cap` is the round limit of
// the Autopilot settings when the job started; null keeps the built-in limit of 3, which every job before
// this version has. Both are nullable with no default, so ADD COLUMN rewrites no row and every stored job
// keeps its data.
export const RAVEN_TEAM_AUTOPILOT_SQL = `
  ALTER TABLE raven_team_jobs ADD COLUMN decision_json TEXT CHECK(decision_json IS NULL OR JSON_VALID(decision_json));
  ALTER TABLE raven_team_jobs ADD COLUMN round_cap INTEGER CHECK(round_cap IS NULL OR round_cap BETWEEN 1 AND 20);
`;
