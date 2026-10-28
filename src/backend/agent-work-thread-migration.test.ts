// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table, a task or the agent's own chat
// included; a failed upgrade leaves the table or its marker; a newer or incomplete history is
// accepted; a work-thread row can point to no task; a `worktree` row can have no path, or a `shared`
// row a path; a deleted task or task thread leaves its work-thread row behind. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const WORK_THREAD_TABLES = { projection_agent_work_threads: [], project_memories: [], project_memory_undo: [] };

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

function insertWorkThread(
  db: DatabaseSync,
  values: { taskId?: string; mode?: string; path?: string | null; branch?: string | null } = {},
): void {
  db.prepare(`INSERT INTO projection_agent_work_threads
    (task_id, agent_id, workspace_mode, worktree_path, worktree_branch, paused_at, created_at, updated_at)
    VALUES (?, 'chief', ?, ?, ?, NULL, '2026-10-03', '2026-10-03')`).run(
    values.taskId ?? "task-1",
    values.mode ?? "worktree",
    values.path === undefined ? "/work/.openbot/worktrees/a1" : values.path,
    values.branch === undefined ? "openbot/a1" : values.branch,
  );
}

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function workThreadTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%work_thread%' ORDER BY name").all();
}

function databaseAtWithSeed(version: number): DatabaseSync {
  const db = databaseAt(version);
  seed(db, version);
  return db;
}

describe("agent work thread migration", () => {
  it.each(Array.from({ length: 38 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAtWithSeed(version);
      // The earlier migrations run first; the rows after them are what v46 must keep.
      if (version < 45) migrateUpTo(db, 45);
      if (version < 38) insertTask(db);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, ...WORK_THREAD_TABLES });
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 47 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back the table and the marker after a late failure, then retries", () => {
    const db = databaseAtWithSeed(45);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=46
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 46 failed");
    expect(contents(db)).toEqual(before);
    expect(workThreadTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=46").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, ...WORK_THREAD_TABLES });
  });

  it("rejects newer and incomplete migration histories before it creates the table", () => {
    const db = databaseAtWithSeed(45);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(48,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=48; DELETE FROM schema_migrations WHERE version=38");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 38");
    expect(contents(db)).toEqual(before);
    expect(workThreadTables(db)).toEqual([]);
  });

  it("keeps a database that a newer build migrated to 46 unchanged on the next start", () => {
    const db = databaseAtWithSeed(45);
    migrateOpenBotDatabase(db);
    insertWorkThread(db);
    const before = contents(db);
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual(before);
  });

  it("refuses a row of no task, a second row of one task, and a workspace that does not match its mode", () => {
    const db = databaseAtWithSeed(45);
    migrateOpenBotDatabase(db);
    expect(() => insertWorkThread(db, { taskId: "task-unknown" })).toThrow("FOREIGN KEY constraint failed");
    expect(() => insertWorkThread(db, { mode: "copy" })).toThrow("CHECK constraint failed");
    expect(() => insertWorkThread(db, { path: null })).toThrow("CHECK constraint failed");
    expect(() => insertWorkThread(db, { branch: null })).toThrow("CHECK constraint failed");
    expect(() => insertWorkThread(db, { mode: "shared" })).toThrow("CHECK constraint failed");
    insertWorkThread(db, { mode: "shared", path: null, branch: null });
    expect(() => insertWorkThread(db)).toThrow("UNIQUE constraint failed");
    expect(
      db.prepare("SELECT task_id, workspace_mode, worktree_path FROM projection_agent_work_threads").all(),
    ).toEqual([{ task_id: "task-1", workspace_mode: "shared", worktree_path: null }]);
  });

  it("deletes the row with its task or the task's thread, and keeps the agent's own chat", () => {
    const db = databaseAtWithSeed(45);
    migrateOpenBotDatabase(db);
    insertWorkThread(db);
    db.prepare("DELETE FROM projection_agent_tasks WHERE task_id='task-1'").run();
    expect(db.prepare("SELECT task_id FROM projection_agent_work_threads").all()).toEqual([]);

    insertTask(db);
    insertWorkThread(db);
    db.prepare("DELETE FROM projection_threads WHERE thread_id='openbot-thread-task'").run();
    expect(db.prepare("SELECT task_id FROM projection_agent_work_threads").all()).toEqual([]);
    expect(db.prepare("SELECT thread_id FROM projection_threads").all()).toEqual([
      { thread_id: "openbot-thread-chief" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
