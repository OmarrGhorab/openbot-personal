// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes of migration 50: the upgrade changes or loses a row of any table, a thread or a task
// included; a failed upgrade leaves a ticket table or its marker; a newer or incomplete history is
// accepted. Migration 50 only creates the ticket tables, so every released row must be unchanged.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const TICKET_TABLES = {
  projection_agent_ticket_links: [],
  projection_agent_ticket_watches: [],
  projection_agent_ticket_pulls: [],
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

describe("agent ticket migration", () => {
  it.each(Array.from({ length: 42 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      // Migrations after `version` also create tables; the rows of every table that existed stay as they were.
      const after = contents(db);
      expect(Object.fromEntries(Object.keys(before).map((table) => [table, after[table]]))).toEqual(before);
      expect(after).toMatchObject(TICKET_TABLES);
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 50 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAt(47);
    seed(db, 47);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=50
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 50 failed");
    expect(contents(db)).toMatchObject(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%ticket%'").all()).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 50").all()).toEqual([]);
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toMatchObject({ ...before, ...TICKET_TABLES });
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 50 });
  });

  it("refuses a history that is missing a version, and leaves the ticket tables out", () => {
    const db = databaseAt(47);
    db.exec("DELETE FROM schema_migrations WHERE version = 20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration history is missing version 20");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%ticket%'").all()).toEqual([]);
  });

  it("creates both ticket tables in a new database", () => {
    const fresh = new DatabaseSync(":memory:");
    databases.push(fresh);
    migrateOpenBotDatabase(fresh);
    expect(
      fresh.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'projection_agent_ticket%' ORDER BY name").all(),
    ).toEqual([
      { name: "projection_agent_ticket_links" },
      { name: "projection_agent_ticket_pulls" },
      { name: "projection_agent_ticket_watches" },
    ]);
  });
});
