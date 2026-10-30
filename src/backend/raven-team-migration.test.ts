// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table, a task or the agent's own chat
// included; a failed upgrade leaves the tables or the marker; a newer or incomplete history is
// accepted; a template, job or role row is saved with a state, access, score or JSON value the table
// refuses; deleting a job leaves its role rows behind. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const RAVEN_TEAM_TABLES = {
  raven_team_jobs: [],
  raven_team_roles: [],
  raven_team_templates: [],
  projection_agent_ticket_links: [],
  projection_agent_ticket_watches: [],
  projection_agent_ticket_pulls: [],
  board_settings: [],
  board_ticket_events: [],
  board_tickets: [],
};
const LATEST = 48;
const MIGRATION_VERSION = LATEST;
// The newest version of the application. The autonomy (49), agent ticket (50), Tickets board (51) and ticket type (52) migrations come after this one.
const LATEST_SCHEMA = 52;

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateUpTo(db, version);
  return db;
}

function migrateUpTo(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
}

/** The agent's own chat and a task thread, in the columns every release has, and a task from schema 38 on. */
function seed(db: DatabaseSync, version: number): void {
  const insert = db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)");
  insert.run("openbot-thread-chief", 'Chief 界"\\', "2026-10-01T10:00:00.000Z", "2026-10-01T10:00:00.000Z");
  insert.run("openbot-thread-task", "Ticket 42", "2026-10-01T11:00:00.000Z", "2026-10-01T11:00:00.000Z");
  if (version >= 38) insertTask(db);
}

function insertTask(db: DatabaseSync, taskId = "task-1", threadId = "openbot-thread-task"): void {
  db.prepare(`INSERT INTO projection_agent_tasks
    (task_id, agent_id, thread_id, origin, title, outcome, error, created_at, updated_at, closed_at,
     last_event_sequence)
    VALUES (?, 'chief', ?, 'user', 'Ticket 42 界', 'completed', NULL, '2026-10-01', '2026-10-02', NULL, 2)`).run(
    taskId,
    threadId,
  );
}

const ROLES_JSON = JSON.stringify([{ id: "builder", label: "Builder", skills: ["build"], defaultModel: null }]);

function insertTemplate(db: DatabaseSync, id = "team-1", rolesJson = ROLES_JSON): void {
  db.prepare(`INSERT INTO raven_team_templates (template_id, name, roles_json, created_at, updated_at)
    VALUES (?, 'Our team', ?, '2026-10-03', '2026-10-03')`).run(id, rolesJson);
}

function insertJob(db: DatabaseSync, values: { id?: string; state?: string } = {}): void {
  db.prepare(`INSERT INTO raven_team_jobs
    (job_id, template_id, brief, state, head_commit, fix_rounds, question_json, created_at, updated_at)
    VALUES (?, 'raven-stack-team', 'Autopilot ticket #42', ?, NULL, 0, NULL, '2026-10-03', '2026-10-03')`).run(
    values.id ?? "job-1",
    values.state ?? "running",
  );
}

function insertRole(db: DatabaseSync, values: { job?: string; role?: string; score?: number | null } = {}): void {
  db.prepare(`INSERT INTO raven_team_roles
    (job_id, role_id, label, skills_json, agent_id, task_id, thread_id, provider, model, access, state, verdict,
     score, commit_sha, fails, pending_message, updated_at)
    VALUES (?, ?, 'Reviewer', '["verify"]', 'agent-1', NULL, NULL, 'codex', 'gpt-6-luna', 'read-only', 'waiting',
     NULL, ?, NULL, 0, NULL, '2026-10-03')`).run(
    values.job ?? "job-1",
    values.role ?? "reviewer",
    values.score === undefined ? null : values.score,
  );
}

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' AND name NOT LIKE 'autonomy_%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function ravenTeamTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'raven_team%' ORDER BY name").all();
}

function databaseAtWithSeed(version: number): DatabaseSync {
  const db = databaseAt(version);
  seed(db, version);
  return db;
}

describe("raven team migration", () => {
  it.each(Array.from({ length: MIGRATION_VERSION - 1 - 8 + 1 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAtWithSeed(version);
      // Older migrations run first; the rows at version 47 are what v48 must keep.
      if (version < MIGRATION_VERSION - 1) migrateUpTo(db, MIGRATION_VERSION - 1);
      if (version < 38) insertTask(db);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, ...RAVEN_TEAM_TABLES });
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: LATEST_SCHEMA,
      });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAtWithSeed(MIGRATION_VERSION - 1);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=${MIGRATION_VERSION}
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${MIGRATION_VERSION} failed`);
    expect(contents(db)).toEqual(before);
    expect(ravenTeamTables(db)).toEqual([]);
    expect(db.prepare(`SELECT version FROM schema_migrations WHERE version=${MIGRATION_VERSION}`).all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toMatchObject({ ...before, ...RAVEN_TEAM_TABLES });
  });

  it("rejects newer and incomplete migration histories before it creates the tables", () => {
    const db = databaseAtWithSeed(MIGRATION_VERSION - 1);
    const before = contents(db);
    db.exec(`INSERT INTO schema_migrations VALUES(${LATEST_SCHEMA + 1},'now')`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec(
      `DELETE FROM schema_migrations WHERE version=${LATEST_SCHEMA + 1}; DELETE FROM schema_migrations WHERE version=38`,
    );
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 38");
    expect(contents(db)).toEqual(before);
    expect(ravenTeamTables(db)).toEqual([]);
  });

  it("keeps a database that is already at version 48 unchanged on the next start", () => {
    const db = databaseAtWithSeed(MIGRATION_VERSION - 1);
    migrateOpenBotDatabase(db);
    insertTemplate(db);
    insertJob(db);
    insertRole(db);
    const before = contents(db);
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
  });

  it("refuses a job or role state, access or score that the table does not list, and bad JSON", () => {
    const db = databaseAtWithSeed(MIGRATION_VERSION - 1);
    migrateOpenBotDatabase(db);
    expect(() => insertTemplate(db, "team-2", "not json")).toThrow("CHECK constraint failed");
    insertTemplate(db);
    expect(() => insertJob(db, { state: "paused" })).toThrow("CHECK constraint failed");
    insertJob(db);
    expect(() => insertRole(db, { role: "qa", score: 11 })).toThrow("CHECK constraint failed");
    insertRole(db, { role: "reviewer", score: 10 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM raven_team_roles").get()).toEqual({ count: 1 });
  });

  it("removes the role rows of a deleted job and keeps the agents and tasks", () => {
    const db = databaseAtWithSeed(MIGRATION_VERSION - 1);
    migrateOpenBotDatabase(db);
    insertJob(db);
    insertRole(db, { role: "builder" });
    insertRole(db, { role: "reviewer" });
    db.prepare("DELETE FROM raven_team_jobs WHERE job_id = 'job-1'").run();
    expect(db.prepare("SELECT COUNT(*) AS count FROM raven_team_roles").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM projection_agent_tasks").get()).toEqual({ count: 1 });
  });
});
