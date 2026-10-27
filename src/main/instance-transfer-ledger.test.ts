import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type MigrationRecord,
  migrationIdFor,
  readMigration,
  removeMigration,
  writeMigration,
} from "./instance-transfer-ledger";

const directories: string[] = [];

async function ledgerPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-migration-"));
  directories.push(directory);
  return join(directory, "instance-transfer-migrations.json");
}

function record(agentId: string, done = false): MigrationRecord {
  return {
    agents: {
      alpha: {
        agentId,
        files: done,
        done,
        skills: {},
        routines: {},
        memories: {},
      },
    },
    updatedAt: new Date(0).toISOString(),
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("migrationIdFor", () => {
  it("is stable for the same keys, in any order, and ignores repeats", () => {
    expect(migrationIdFor(["beta", "alpha", "beta"])).toBe(migrationIdFor(["alpha", "beta"]));
    expect(migrationIdFor(["alpha"])).not.toBe(migrationIdFor(["alpha", "beta"]));
  });

  it("names a selection with a 64-character id", () => {
    expect(migrationIdFor(["alpha"])).toMatch(/^[\da-f]{64}$/u);
  });
});

describe("migration ledger", () => {
  it("keeps one migration per owner and reads it back", async () => {
    const path = await ledgerPath();
    const first = record("agent-1");
    const second = record("agent-2", true);

    await writeMigration(path, "local", "migration-1", first);
    await writeMigration(path, "member", "migration-1", second);

    expect((await readMigration(path, "local", "migration-1"))?.agents).toEqual(first.agents);
    expect((await readMigration(path, "member", "migration-1"))?.agents).toEqual(second.agents);
    expect(await readMigration(path, "local", "migration-2")).toBeNull();
  });

  it("removes one migration and leaves the other owners alone", async () => {
    const path = await ledgerPath();
    await writeMigration(path, "local", "migration-1", record("agent-1"));
    await writeMigration(path, "member", "migration-1", record("agent-2"));

    await removeMigration(path, "local", "migration-1");

    expect(await readMigration(path, "local", "migration-1")).toBeNull();
    expect(await readMigration(path, "member", "migration-1")).not.toBeNull();
  });

  it("removes the file once no migration is left", async () => {
    const path = await ledgerPath();
    await writeMigration(path, "local", "migration-1", record("agent-1"));

    await removeMigration(path, "local", "migration-1");

    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces a corrupt ledger rather than losing the next migration", async () => {
    const path = await ledgerPath();
    await writeFile(path, "not json", "utf8");

    await writeMigration(path, "local", "migration-1", record("agent-1"));

    expect((await readMigration(path, "local", "migration-1"))?.agents).toEqual(record("agent-1").agents);
  });
});
