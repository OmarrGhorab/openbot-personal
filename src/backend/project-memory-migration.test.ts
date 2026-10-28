// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table, a task or the agent's own chat
// included; a failed upgrade leaves the tables or the marker; a newer or incomplete history is
// accepted; a project entry is saved with a kind or text the table refuses, or two entries of one
// project share a normalized text; the undo slot holds a change with no before-state, or a before-state
// that is not an entry. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const PROJECT_MEMORY_TABLES = {
  project_memories: [],
  project_memory_undo: [],
  raven_team_jobs: [],
  raven_team_roles: [],
  raven_team_templates: [],
  projection_agent_ticket_links: [],
  projection_agent_ticket_watches: [],
  projection_agent_ticket_pulls: [],
};
const LATEST = 47;
const MIGRATION_VERSION = LATEST;
// The newest version of the application. The Raven Stack team (48), autonomy (49) and agent ticket (50) migrations come after this one.
const LATEST_SCHEMA = 50;

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

function insertMemory(
  db: DatabaseSync,
  values: { id?: string; project?: string; kind?: string; text?: string; normalized?: string } = {},
): void {
  db.prepare(`INSERT INTO project_memories
    (memory_id, project_key, kind, text, normalized_text, saved_by_agent_id, updated_by_agent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, '2026-10-03', '2026-10-03')`).run(
    values.id ?? "memory-1",
    values.project ?? "/work/project",
    values.kind ?? "command",
    values.text ?? "Run bun run test:changed.",
    values.normalized ?? "run bun run test:changed.",
  );
}

function insertUndo(
  db: DatabaseSync,
  values: { project?: string; action?: string; before?: string | null; memoryId?: string } = {},
): void {
  db.prepare(`INSERT INTO project_memory_undo
    (project_key, action, memory_id, before_json, changed_by_agent_id, changed_at)
    VALUES (?, ?, ?, ?, NULL, '2026-10-03')`).run(
    values.project ?? "/work/project",
    values.action ?? "create",
    values.memoryId ?? "memory-1",
    values.before === undefined ? null : values.before,
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

function projectMemoryTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'project_memor%' ORDER BY name").all();
}

function databaseAtWithSeed(version: number): DatabaseSync {
  const db = databaseAt(version);
  seed(db, version);
  return db;
}

describe("project memory migration", () => {
  it.each(Array.from({ length: MIGRATION_VERSION - 1 - 8 + 1 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAtWithSeed(version);
      // Older migrations run first; the rows at version 46 are what v47 must keep.
      if (version < MIGRATION_VERSION - 1) migrateUpTo(db, MIGRATION_VERSION - 1);
      if (version < 38) insertTask(db);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, ...PROJECT_MEMORY_TABLES });
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
    expect(projectMemoryTables(db)).toEqual([]);
    expect(db.prepare(`SELECT version FROM schema_migrations WHERE version=${MIGRATION_VERSION}`).all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, ...PROJECT_MEMORY_TABLES });
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
    expect(projectMemoryTables(db)).toEqual([]);
  });

  it("keeps a database that is already at version 47 unchanged on the next start", () => {
    const db = databaseAtWithSeed(MIGRATION_VERSION - 1);
    migrateOpenBotDatabase(db);
    insertMemory(db);
    insertUndo(db, { action: "create", before: null });
    const before = contents(db);
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
  });

  it("refuses a kind outside the list, an empty or over-long text, and a duplicate normalized text", () => {
    const db = databaseAtWithSeed(MIGRATION_VERSION - 1);
    migrateOpenBotDatabase(db);
    expect(() => insertMemory(db, { kind: "tip" })).toThrow("CHECK constraint failed");
    expect(() => insertMemory(db, { text: "" })).toThrow("CHECK constraint failed");
    expect(() => insertMemory(db, { text: "x".repeat(501) })).toThrow("CHECK constraint failed");
    insertMemory(db, { id: "memory-long", text: "x".repeat(500), normalized: "x".repeat(500) });
    insertMemory(db);
    expect(() => insertMemory(db, { id: "memory-2" })).toThrow("UNIQUE constraint failed");
    insertMemory(db, { id: "memory-3", project: "/work/other" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM project_memories").get()).toEqual({ count: 3 });
  });

  it("refuses an undo slot whose before-state does not match its action", () => {
    const db = databaseAtWithSeed(MIGRATION_VERSION - 1);
    migrateOpenBotDatabase(db);
    insertMemory(db);
    expect(() => insertUndo(db, { action: "create", before: "{}" })).toThrow("CHECK constraint failed");
    expect(() => insertUndo(db, { action: "update", before: null })).toThrow("CHECK constraint failed");
    expect(() => insertUndo(db, { action: "delete", before: "not json" })).toThrow("CHECK constraint failed");
    expect(() => insertUndo(db, { action: "rename", before: "{}" })).toThrow("CHECK constraint failed");
    insertUndo(db, { action: "delete", before: '{"id":"memory-1"}' });
    expect(() => insertUndo(db, { action: "create", before: null, memoryId: "memory-9" })).toThrow(
      "UNIQUE constraint failed",
    );
    expect(db.prepare("SELECT action FROM project_memory_undo").all()).toEqual([{ action: "delete" }]);
  });
});
