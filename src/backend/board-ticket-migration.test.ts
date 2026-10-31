// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes of migration 51: the upgrade changes or loses a row of any table, a work thread or a
// ticket watch included; a failed upgrade leaves a board table or its marker; an incomplete history is
// accepted; a work thread becomes a board ticket. Migration 51 only creates the Tickets board tables, so
// every released row must be unchanged and the board starts empty.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const BOARD_TABLES = {
  board_settings: [],
  board_ticket_events: [],
  board_ticket_evidence: [],
  board_tickets: [],
};

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

/** The agent's own chat and a task thread, in the columns every release has. */
function seed(db: DatabaseSync, version: number): void {
  const insert = db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)");
  insert.run("openbot-thread-chief", 'Chief 界"\\', "2026-10-01T10:00:00.000Z", "2026-10-01T10:00:00.000Z");
  insert.run("openbot-thread-task", "Ticket 42", "2026-10-01T11:00:00.000Z", "2026-10-01T11:00:00.000Z");
  if (version >= 50) {
    db.prepare(
      "INSERT INTO projection_agent_ticket_watches VALUES ('chief', 'github', 'o/r', 'openbot', 1, 'a', 'b')",
    ).run();
    db.prepare("INSERT INTO projection_agent_ticket_links VALUES ('chief', 'github', 'o/r#42', 'task-1', 'a')").run();
  }
  if (version >= 38) {
    db.prepare(`INSERT INTO projection_agent_tasks
      (task_id, agent_id, thread_id, origin, title, outcome, error, created_at, updated_at, closed_at,
       last_event_sequence)
      VALUES ('task-1', 'chief', 'openbot-thread-task', 'user', 'Ticket 42 界', 'completed', NULL,
       '2026-10-01', '2026-10-02', NULL, 2)`).run();
  }
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

describe("board ticket migration", () => {
  it.each(Array.from({ length: 43 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      // Migrations after `version` also create tables; the rows of every table that existed stay as they were.
      const after = contents(db);
      expect(Object.fromEntries(Object.keys(before).map((table) => [table, after[table]]))).toEqual(before);
      expect(after).toMatchObject(BOARD_TABLES);
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAt(50);
    seed(db, 50);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=51
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 51 failed");
    expect(contents(db)).toMatchObject(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'board_%'").all()).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 51").all()).toEqual([]);
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toMatchObject({ ...before, ...BOARD_TABLES });
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });
  });

  it("refuses a history that is missing a version, and leaves the board tables out", () => {
    const db = databaseAt(47);
    db.exec("DELETE FROM schema_migrations WHERE version = 20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration history is missing version 20");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'board_%'").all()).toEqual([]);
  });

  it("creates the board tables in a new database, and the board starts empty", () => {
    const fresh = new DatabaseSync(":memory:");
    databases.push(fresh);
    migrateOpenBotDatabase(fresh);
    expect(
      fresh.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'board_%' ORDER BY name").all(),
    ).toEqual([
      { name: "board_settings" },
      { name: "board_ticket_events" },
      { name: "board_ticket_evidence" },
      { name: "board_tickets" },
    ]);
    expect(contents(fresh)).toMatchObject(BOARD_TABLES);
  });

  it("deletes the events of a deleted ticket and keeps its work thread", () => {
    const db = databaseAt(50);
    seed(db, 50);
    migrateOpenBotDatabase(db);
    db.prepare(`INSERT INTO board_tickets (ticket_id, title, status, sort_order, task_id, status_changed_at,
      created_at, updated_at) VALUES ('t1', 'Ticket 界', 'running', 1, 'task-1', 'a', 'a', 'a')`).run();
    db.prepare(
      "INSERT INTO board_ticket_events VALUES ('e1', 't1', 'created', 'user', NULL, 'backlog', NULL, 'a')",
    ).run();
    db.prepare("DELETE FROM board_tickets WHERE ticket_id = 't1'").run();
    expect(db.prepare("SELECT * FROM board_ticket_events").all()).toEqual([]);
    expect(db.prepare("SELECT task_id FROM projection_agent_tasks").all()).toEqual([{ task_id: "task-1" }]);
  });
});
