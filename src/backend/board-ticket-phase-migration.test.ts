// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes of migration 55 (ticket phase, ticket 237): the upgrade changes or loses a ticket or an
// event or their order; a failed upgrade leaves a half-built table; the new column takes any text.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

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

function seed(db: DatabaseSync): void {
  db.prepare(`INSERT INTO board_tickets (ticket_id, title, body, status, type, type_source, agent_id, sort_order,
      task_id, thread_id, team_job_id, team_role_id, external_provider, external_key, external_url, progress, error,
      status_changed_at, created_at, updated_at)
    VALUES ('t-1', 'Fix sub 界', 'Body', 'running', 'bug', 'user', 'chief', 1, 'task-1', 'thread-1', NULL, NULL,
      NULL, NULL, NULL, 'Checked', NULL, 'a', 'a', 'b')`).run();
  db.prepare(`INSERT INTO board_ticket_events VALUES
    ('e-2', 't-1', 'comment', 'agent', NULL, NULL, 'FAIL sub(5,2)=-3', 'b'),
    ('e-1', 't-1', 'created', 'user', NULL, 'backlog', NULL, 'a')`).run();
}

function rows(db: DatabaseSync, table: string): unknown[] {
  return db.prepare(`SELECT rowid AS position, * FROM "${table}" ORDER BY rowid`).all();
}

describe("board ticket phase migration", () => {
  it("adds a null phase and the phase event kind, keeping every ticket and event in order", () => {
    const db = databaseAt(54);
    seed(db);
    const tickets = rows(db, "board_tickets");
    const events = rows(db, "board_ticket_events");
    migrateOpenBotDatabase(db);
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 55 });
    expect(rows(db, "board_tickets")).toEqual(tickets.map((row) => Object.assign({}, row, { phase: null })));
    expect(rows(db, "board_ticket_events")).toEqual(events);
    db.prepare("UPDATE board_tickets SET phase = 'verify'").run();
    db.prepare(
      "INSERT INTO board_ticket_events VALUES ('e-3', 't-1', 'phase', 'agent', NULL, NULL, 'verify', 'c')",
    ).run();
    expect(() => db.prepare("UPDATE board_tickets SET phase = 'ship'").run()).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("leaves the old tables when the upgrade fails, then retries", () => {
    const db = databaseAt(54);
    seed(db);
    const events = rows(db, "board_ticket_events");
    db.exec(`CREATE TEMP TRIGGER stop_at_55 BEFORE INSERT ON schema_migrations WHEN new.version = 55
      BEGIN SELECT RAISE(ABORT, 'stop'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 55 failed");
    expect(db.prepare("SELECT name FROM pragma_table_info('board_tickets') WHERE name = 'phase'").all()).toEqual([]);
    expect(rows(db, "board_ticket_events")).toEqual(events);
    db.exec("DROP TRIGGER stop_at_55");
    migrateOpenBotDatabase(db);
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 55 });
  });
});
