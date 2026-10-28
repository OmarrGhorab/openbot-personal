// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "../openbot-database-schema";

// Failure modes: the upgrade from 46 changes or loses a row of the agent's own chat; a failed upgrade
// leaves a table or its marker behind; a retry after the failure does not finish; a usage row with a
// negative count or an unknown risk level is accepted; the audit table lacks its columns. These
// fixtures cover each. The upgrade only creates tables, so it never copies a row.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const AUTONOMY_TABLES = ["autonomy_audit_log", "autonomy_turn_usage"];

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateUpTo(db, version);
  return db;
}

/** Migrates up to `version`, with the next migration failing at its marker, as the other fixtures do. */
function migrateUpTo(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
}

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

function seedChat(db: DatabaseSync): void {
  db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)").run(
    "openbot-thread-chief",
    "Chief chat",
    "2026-10-01T10:00:00.000Z",
    "2026-10-01T10:00:00.000Z",
  );
}

describe("autonomy schema migration (version 47)", () => {
  it("keeps every row of a database at version 46 and adds empty tables", () => {
    const db = databaseAt(46);
    seedChat(db);
    expect(tableNames(db)).not.toEqual(expect.arrayContaining(AUTONOMY_TABLES));

    migrateOpenBotDatabase(db, { appliedAt: "2026-10-28T10:00:00.000Z" });

    expect(db.prepare("SELECT COUNT(*) AS count FROM projection_threads").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT title FROM projection_threads").get()).toEqual({ title: "Chief chat" });
    for (const table of AUTONOMY_TABLES) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 47").get()).toEqual({ version: 47 });
  });

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAt(46);
    seedChat(db);
    db.exec(`CREATE TEMP TRIGGER fail_autonomy BEFORE INSERT ON schema_migrations WHEN new.version = 47
      BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 47 failed");
    db.exec("DROP TRIGGER fail_autonomy");

    for (const table of AUTONOMY_TABLES) expect(tableNames(db)).not.toContain(table);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 47").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS count FROM projection_threads").get()).toEqual({ count: 1 });

    migrateOpenBotDatabase(db);
    for (const table of AUTONOMY_TABLES) expect(tableNames(db)).toContain(table);
    expect(db.prepare("SELECT COUNT(*) AS count FROM projection_threads").get()).toEqual({ count: 1 });
  });

  it("leaves a database that is already at 47 unchanged on the next start", () => {
    const db = databaseAt(46);
    seedChat(db);
    migrateOpenBotDatabase(db);
    db.prepare(
      `INSERT INTO autonomy_turn_usage (turn_id, agent_id, thread_id, task_id, started_at, ended_at, duration_ms, tokens, cost_usd)
       VALUES ('turn-1', 'chief', 'openbot-thread-chief', NULL, '2026-10-28T10:00:00.000Z', '2026-10-28T10:01:00.000Z', 60000, 1200, 0.01)`,
    ).run();

    migrateOpenBotDatabase(db);

    expect(db.prepare("SELECT COUNT(*) AS count FROM autonomy_turn_usage").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 47").get()).toEqual({
      count: 1,
    });
  });

  it("refuses a usage row with a negative count and an audit row with an unknown risk", () => {
    const db = databaseAt(46);
    migrateOpenBotDatabase(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO autonomy_turn_usage (turn_id, agent_id, thread_id, task_id, started_at, ended_at, duration_ms, tokens, cost_usd)
           VALUES ('turn-x', 'chief', 'thread', NULL, 'a', 'b', 0, -1, NULL)`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO autonomy_audit_log (occurred_at, action, agent_id, thread_id, task_id, risk, result, target, detail)
           VALUES ('a', 'approval.auto', 'chief', NULL, NULL, 'critical', 'approved', 'x', '')`,
        )
        .run(),
    ).toThrow();
  });
});
