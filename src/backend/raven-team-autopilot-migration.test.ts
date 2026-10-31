// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { isRavenAutopilotDecision, type RavenAutopilotDecision } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes of migration 53 (Autopilot on team jobs): ADD COLUMN changes or loses a job, a role or
// their order; a stored job gets a decision or a round limit it did not have; a column accepts text that is
// not JSON or a round limit out of range; a failed upgrade leaves one column without the other. Every
// released row must stay as it was, and every existing job reads with no decision and the built-in limit.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const TIME = "Fri 2026-10-30 4:00 AM EET (UTC+02:00)";

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

/** Rows every release has, and two team jobs with their roles once the schema has the team tables (48). */
function seed(db: DatabaseSync, version: number): void {
  const insert = db.prepare("INSERT INTO projection_threads VALUES (?, 'chief', ?, NULL, ?, ?, 1)");
  insert.run("openbot-thread-chief", 'Chief 界"\\', TIME, TIME);
  insert.run("openbot-thread-role", "Builder", TIME, TIME);
  if (version < 48) return;
  db.prepare(`INSERT INTO raven_team_jobs
    (job_id, template_id, brief, state, head_commit, fix_rounds, question_json, fallback_model, created_at, updated_at)
    VALUES
    ('job-running', 'raven-stack-team', 'Fix the login 界 "quoted"\nwith lines', 'running', 'abc123', 2,
     '{"kind":"blocked","roleId":"reviewer"}', 'gpt-5.5', '${TIME}', '${TIME}'),
    ('job-done', 'raven-stack-lite', 'Write the notes', 'done', NULL, 0, NULL, NULL, 'a', 'b')`).run();
  db.prepare(`INSERT INTO raven_team_roles
    (job_id, role_id, label, skills_json, agent_id, task_id, thread_id, provider, model, access, state, verdict,
     score, commit_sha, fails, reminders, pending_message, updated_at)
    VALUES
    ('job-running', 'builder', 'Builder', '["pstack"]', 'agent-b', 'task-b', 'openbot-thread-role', 'codex',
     'gpt-5.5', 'write', 'working', NULL, NULL, 'abc123', 1, 2, 'Keep 界 "this"', '${TIME}'),
    ('job-running', 'reviewer', 'Reviewer', '[]', NULL, NULL, NULL, 'claude', 'opus', 'read-only', 'failed',
     'FAIL', 4, NULL, 1, 0, NULL, '${TIME}'),
    ('job-done', 'builder', 'Builder', '[]', NULL, NULL, NULL, 'codex', 'mini', 'write', 'passed', 'DONE',
     NULL, NULL, 0, 0, NULL, 'b')`).run();
}

/** Every row of every table, by table name, in rowid order. */
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
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

const DECISION: RavenAutopilotDecision = {
  ticketId: "t-1",
  ticketTitle: "Add dark mode 界",
  ticketType: "feature",
  stack: "raven-stack",
  templateId: "raven-stack-team",
  playbook: null,
  roles: [{ roleId: "builder", label: "Builder", model: "gpt-5.5" }],
  reason: "A feature that touches 6 files, so the full Raven Stack team plans first and a second model reviews.",
  source: "auto",
  decidedAt: TIME,
  reasonCode: "feature-large",
  changeSize: "large",
  files: 6,
  repo: "o/r",
  modelTier: "strong",
  switches: [{ round: 1, roleId: "builder", kind: "model", from: "gpt-5.5", to: "opus", at: TIME }],
};

describe("raven team Autopilot migration", () => {
  it.each(Array.from({ length: 45 }, (_, index) => index + 8))(
    "preserves every row from released schema %i, and every job has no decision and no round limit",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      const after = contents(db);
      const jobs = (before.raven_team_jobs ?? []).map((row) =>
        Object.assign({}, row, { decision_json: null, round_cap: null }),
      );
      expect(Object.fromEntries(Object.keys(before).map((table) => [table, after[table]]))).toEqual({
        ...before,
        ...(before.raven_team_jobs ? { raven_team_jobs: jobs } : {}),
      });
      expect(columns(db, "raven_team_jobs")).toEqual(expect.arrayContaining(["decision_json", "round_cap"]));
      expectHealthy(db);
    },
  );

  it("keeps a decision that the contract reads back, and refuses text that is not JSON or a limit out of range", () => {
    const db = databaseAt(52);
    seed(db, 52);
    migrateOpenBotDatabase(db);
    db.prepare("UPDATE raven_team_jobs SET decision_json = ?, round_cap = 5 WHERE job_id = 'job-running'").run(
      JSON.stringify(DECISION),
    );
    const row = db.prepare("SELECT decision_json, round_cap FROM raven_team_jobs WHERE job_id = 'job-running'").get();
    expect(isRavenAutopilotDecision(JSON.parse(String(row?.decision_json)))).toBe(true);
    expect(JSON.parse(String(row?.decision_json))).toEqual(DECISION);
    expect(row?.round_cap).toBe(5);
    expect(() =>
      db.prepare("UPDATE raven_team_jobs SET decision_json = 'not json' WHERE job_id = 'job-done'").run(),
    ).toThrow();
    expect(() => db.prepare("UPDATE raven_team_jobs SET round_cap = 0 WHERE job_id = 'job-done'").run()).toThrow();
    expect(() => db.prepare("UPDATE raven_team_jobs SET round_cap = 21 WHERE job_id = 'job-done'").run()).toThrow();
    expectHealthy(db);
  });

  it("leaves no column behind when the upgrade to 53 fails", () => {
    const db = databaseAt(52);
    seed(db, 52);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER stop_at_53 BEFORE INSERT ON schema_migrations WHEN new.version = 53
      BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 53 failed");
    db.exec("DROP TRIGGER stop_at_53");
    expect(columns(db, "raven_team_jobs")).not.toContain("decision_json");
    expect(columns(db, "raven_team_jobs")).not.toContain("round_cap");
    expect(contents(db)).toEqual(before);
  });
});
