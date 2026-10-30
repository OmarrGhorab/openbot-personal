// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes of migration 52 (ticket type): the rebuild of `board_tickets` or `board_ticket_events`
// changes or loses a row, a column value, a link or the order of the events; a ticket gets a type it did
// not have; a failed upgrade leaves a half-built table, the `_v52` copies or its marker; an event that
// lost its ticket goes through; an incomplete or newer history is accepted. Every released row must stay
// as it was, and every existing ticket gets a null type.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const TIME = "Thu 2026-10-29 3:00 PM EEST (UTC+03:00)";

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  return db;
}

/** Rows that every release has, and the board of version 51 when the schema has it. */
function seed(db: DatabaseSync, version: number): void {
  const insert = db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)");
  insert.run("openbot-thread-chief", 'Chief 界"\\', TIME, TIME);
  insert.run("openbot-thread-task", "Ticket 42", TIME, TIME);
  if (version >= 38) {
    db.prepare(`INSERT INTO projection_agent_tasks
      (task_id, agent_id, thread_id, origin, title, outcome, error, created_at, updated_at, closed_at,
       last_event_sequence)
      VALUES ('task-1', 'chief', 'openbot-thread-task', 'user', 'Ticket 42 界', 'completed', NULL,
       '2026-10-01', '2026-10-02', NULL, 2)`).run();
  }
  if (version < 51) return;
  db.prepare(`INSERT INTO board_tickets VALUES
    ('t-linked', 'Fix the login 界 "quoted"', 'Body\nwith lines', 'running', 'chief', 1.5, 'task-1',
     'openbot-thread-task', 'job-1', 'builder', 'github', 'o/r#42', 'https://github.com/o/r/issues/42',
     'Checked 41 of 112 links', 'The last turn failed', '${TIME}', '${TIME}', '${TIME}'),
    ('t-local', 'Write the notes', '', 'backlog', NULL, -0.25, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, 'a', 'a', 'b')`).run();
  // Two events at the same time: only the rowid keeps their order.
  db.prepare(`INSERT INTO board_ticket_events VALUES
    ('e-created', 't-linked', 'created', 'sync', NULL, 'backlog', NULL, '${TIME}'),
    ('e-moved', 't-linked', 'moved', 'agent', 'backlog', 'running', NULL, '${TIME}'),
    ('e-assigned', 't-linked', 'assigned', 'user', NULL, NULL, 'chief', '${TIME}'),
    ('e-comment', 't-local', 'comment', 'user', NULL, NULL, 'Keep 界 "this"', 'a'),
    ('e-progress', 't-linked', 'progress', 'agent', NULL, NULL, 'Checked 41 of 112 links', '${TIME}')`).run();
  db.prepare(`INSERT INTO board_settings VALUES ('main', 'github', 'o/r', '${TIME}', '${TIME}')`).run();
}

/** Every row of every table, by table name. The events keep their rowid, which orders equal times. */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(
    tables.map((table) => [table, db.prepare(`SELECT rowid AS position, * FROM "${table}" ORDER BY rowid`).all()]),
  );
}

function columns(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String(row.name));
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 52 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_v52'").all()).toEqual([]);
}

describe("board ticket type migration", () => {
  it.each(Array.from({ length: 44 }, (_, index) => index + 8))(
    "preserves every row from released schema %i, and every ticket gets a null type",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      const after = contents(db);
      const tickets = (before.board_tickets ?? []).map((row) =>
        Object.assign({}, row, { type: null, type_source: null }),
      );
      expect(Object.fromEntries(Object.keys(before).map((table) => [table, after[table]]))).toEqual({
        ...before,
        ...(before.board_tickets ? { board_tickets: tickets } : {}),
      });
      expect(columns(db, "board_tickets")).toContain("type");
      expect(columns(db, "board_tickets")).toContain("type_source");
      expectHealthy(db);
    },
  );

  it("keeps the order of events with the same time, and their cascade from the ticket", () => {
    const db = databaseAt(51);
    seed(db, 51);
    migrateOpenBotDatabase(db);
    expect(
      db
        .prepare("SELECT event_id FROM board_ticket_events WHERE ticket_id = 't-linked' ORDER BY created_at, rowid")
        .all(),
    ).toEqual([
      { event_id: "e-created" },
      { event_id: "e-moved" },
      { event_id: "e-assigned" },
      { event_id: "e-progress" },
    ]);
    db.prepare("DELETE FROM board_tickets WHERE ticket_id = 't-linked'").run();
    expect(db.prepare("SELECT event_id FROM board_ticket_events").all()).toEqual([{ event_id: "e-comment" }]);
    expect(db.prepare("SELECT task_id FROM projection_agent_tasks").all()).toEqual([{ task_id: "task-1" }]);
  });

  it("accepts the new type and event kind, and rejects an unknown one", () => {
    const db = databaseAt(51);
    seed(db, 51);
    migrateOpenBotDatabase(db);
    db.prepare("UPDATE board_tickets SET type = 'bug', type_source = 'user' WHERE ticket_id = 't-local'").run();
    db.prepare(
      "INSERT INTO board_ticket_events VALUES ('e-type', 't-local', 'type_changed', 'user', NULL, NULL, 'bug', 'c')",
    ).run();
    expect(() => db.prepare("UPDATE board_tickets SET type = 'epic' WHERE ticket_id = 't-local'").run()).toThrow();
    expect(() =>
      db.prepare("UPDATE board_tickets SET type_source = 'guess' WHERE ticket_id = 't-local'").run(),
    ).toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO board_ticket_events VALUES ('e-x', 't-local', 'renamed', 'user', NULL, NULL, NULL, 'c')")
        .run(),
    ).toThrow();
    expect(db.prepare("SELECT type, type_source FROM board_tickets WHERE ticket_id = 't-local'").get()).toEqual({
      type: "bug",
      type_source: "user",
    });
  });

  it("rolls back both tables and the marker after a late failure, then retries", () => {
    const db = databaseAt(51);
    seed(db, 51);
    const before = contents(db);
    const schemaBefore = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=52
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 52 failed");
    expect(contents(db)).toEqual(before);
    expect(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all()).toEqual(schemaBefore);
    expect(columns(db, "board_tickets")).not.toContain("type");
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db).board_ticket_events).toEqual(before.board_ticket_events);
    expectHealthy(db);
  });

  it("stops on an event whose ticket is gone and deletes nothing to get past it", () => {
    const db = databaseAt(51);
    seed(db, 51);
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare(
      "INSERT INTO board_ticket_events VALUES ('e-orphan', 't-gone', 'comment', 'user', NULL, NULL, 'x', 'a')",
    ).run();
    db.exec("PRAGMA foreign_keys = ON");
    const before = contents(db);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 52 failed");
    expect(contents(db)).toEqual(before);
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 51 });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("refuses a newer or incomplete history and leaves the tables as they were", () => {
    const db = databaseAt(51);
    seed(db, 51);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(53,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=53; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(columns(db, "board_tickets")).not.toContain("type");
  });

  it("gives a new database the type columns and an empty board", () => {
    const fresh = new DatabaseSync(":memory:");
    databases.push(fresh);
    migrateOpenBotDatabase(fresh);
    expect(columns(fresh, "board_tickets").slice(0, 6)).toEqual([
      "ticket_id",
      "title",
      "body",
      "status",
      "type",
      "type_source",
    ]);
    expect(contents(fresh)).toMatchObject({ board_tickets: [], board_ticket_events: [], board_settings: [] });
    expectHealthy(fresh);
  });
});
