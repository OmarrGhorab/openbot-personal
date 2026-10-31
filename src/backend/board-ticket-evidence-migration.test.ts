// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes of migration 54 (ticket evidence, #236): the upgrade changes or loses a ticket or an
// event; a failed upgrade leaves the table or its marker behind; evidence outlives its ticket; a
// screenshot row without its stored file goes through.
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
    ('e-1', 't-1', 'created', 'user', NULL, 'backlog', NULL, 'a'),
    ('e-2', 't-1', 'comment', 'agent', NULL, NULL, 'FAIL sub(5,2)=-3', 'b')`).run();
}

function rows(db: DatabaseSync, table: string): unknown[] {
  return db.prepare(`SELECT rowid AS position, * FROM "${table}" ORDER BY rowid`).all();
}

describe("board ticket evidence migration", () => {
  it("adds the evidence table and keeps every ticket and event", () => {
    const db = databaseAt(53);
    seed(db);
    const tickets = rows(db, "board_tickets");
    const events = rows(db, "board_ticket_events");
    migrateOpenBotDatabase(db);
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 56 });
    // Migration 55 (ticket 237) adds a null phase after the evidence table.
    expect(rows(db, "board_tickets")).toEqual(tickets.map((row) => Object.assign({}, row, { phase: null })));
    expect(rows(db, "board_ticket_events")).toEqual(events);
    expect(rows(db, "board_ticket_evidence")).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("leaves no table behind when the upgrade fails, then retries", () => {
    const db = databaseAt(53);
    db.exec(`CREATE TEMP TRIGGER stop_at_54 BEFORE INSERT ON schema_migrations WHEN new.version = 54
      BEGIN SELECT RAISE(ABORT, 'stop'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 54 failed");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'board_ticket_evidence'").all()).toEqual([]);
    db.exec("DROP TRIGGER stop_at_54");
    migrateOpenBotDatabase(db);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'board_ticket_evidence'").all()).toHaveLength(1);
  });

  it("deletes the evidence of a deleted ticket, and refuses a screenshot without its file", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    migrateOpenBotDatabase(db);
    db.exec("PRAGMA foreign_keys = ON");
    seed(db);
    db.prepare(`INSERT INTO board_ticket_evidence (evidence_id, ticket_id, kind, phase, actor, stored_name,
        size_bytes, created_at) VALUES ('ev-1', 't-1', 'screenshot', 'before', 'agent', 'ev-1.png', 10, 'c')`).run();
    expect(() =>
      db
        .prepare(`INSERT INTO board_ticket_evidence (evidence_id, ticket_id, kind, phase, actor, size_bytes, created_at)
          VALUES ('ev-2', 't-1', 'screenshot', 'after', 'agent', 10, 'c')`)
        .run(),
    ).toThrow();
    db.prepare("DELETE FROM board_tickets WHERE ticket_id = 't-1'").run();
    expect(rows(db, "board_ticket_evidence")).toEqual([]);
  });
});
