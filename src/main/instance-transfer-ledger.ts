// The target's record of one instance migration: which source agent became which target agent, and
// which routines, memories and skills it already created. A retry of the same archive resumes from
// this record, and a rollback deletes only what the record names. One file holds every owner, so a
// member's migration on a joined host is separate from the local user's.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { isMissingFileError } from "../backend/file-errors";

const LEDGER_VERSION = 1;
const MIGRATION_PREFIX = "openbot-transfer-migration-v1";

interface MigrationSkillRecord {
  /** The local skill id and the revision this migration published. */
  id: string;
  revision: number;
}

interface MigrationAgentRecord {
  agentId: string;
  /** Its workspace files are written. */
  files: boolean;
  /** Every step of the agent finished. */
  done: boolean;
  /** Source skill folder to the revision this migration published. */
  skills: Record<string, MigrationSkillRecord>;
  /** Source routine id to the target routine id. */
  routines: Record<string, string>;
  /** Source memory index to the target memory id. */
  memories: Record<string, string>;
}

export interface MigrationRecord {
  agents: Record<string, MigrationAgentRecord>;
  updatedAt: string;
}

interface LedgerFile {
  version: typeof LEDGER_VERSION;
  owners: Record<string, Record<string, MigrationRecord>>;
}

/**
 * The same selection of an archive always has the same id, so a retry resumes rather than copies
 * again. The keys are agent keys from the manifest: they stay the same across exports of one setup.
 */
export function migrationIdFor(keys: readonly string[]): string {
  const unique = [...new Set(keys)].sort();
  return createHash("sha256")
    .update([MIGRATION_PREFIX, ...unique].join("\n"))
    .digest("hex");
}

function emptyFile(): LedgerFile {
  return { version: LEDGER_VERSION, owners: {} };
}

function migration(value: unknown): MigrationRecord {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.agents)) throw new Error("Invalid migration ledger.");
  const agents: Record<string, MigrationAgentRecord> = {};
  for (const [key, entry] of Object.entries(value.agents)) {
    if (!isDynamicRecord(entry)) throw new Error("Invalid migration ledger.");
    if (!isString(entry.agentId) || typeof entry.files !== "boolean" || typeof entry.done !== "boolean")
      throw new Error("Invalid migration ledger.");
    agents[key] = {
      agentId: entry.agentId,
      files: entry.files,
      done: entry.done,
      skills: skills(entry.skills),
      routines: strings(entry.routines),
      memories: strings(entry.memories),
    };
  }
  return { agents, updatedAt: isString(value.updatedAt) ? value.updatedAt : new Date(0).toISOString() };
}

function skills(value: unknown): Record<string, MigrationSkillRecord> {
  if (value === undefined) return {};
  if (!isDynamicRecord(value)) throw new Error("Invalid migration ledger.");
  const result: Record<string, MigrationSkillRecord> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isDynamicRecord(entry) || !isString(entry.id) || typeof entry.revision !== "number")
      throw new Error("Invalid migration ledger.");
    result[key] = { id: entry.id, revision: entry.revision };
  }
  return result;
}

function strings(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isDynamicRecord(value)) throw new Error("Invalid migration ledger.");
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isString(entry)) throw new Error("Invalid migration ledger.");
    result[key] = entry;
  }
  return result;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

async function load(path: string): Promise<LedgerFile | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid migration ledger.");
  }
  if (!isDynamicRecord(value) || value.version !== LEDGER_VERSION || !isDynamicRecord(value.owners))
    throw new Error("Invalid migration ledger.");
  const owners: Record<string, Record<string, MigrationRecord>> = {};
  for (const [owner, entries] of Object.entries(value.owners)) {
    if (!isDynamicRecord(entries)) throw new Error("Invalid migration ledger.");
    owners[owner] = Object.fromEntries(
      Object.entries(entries).map(([migrationId, entry]) => [migrationId, migration(entry)]),
    );
  }
  return { version: LEDGER_VERSION, owners };
}

async function save(path: string, file: LedgerFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const part = `${path}.${randomUUID()}.part`;
  try {
    await writeFile(part, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    await rename(part, path);
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
}

export async function readMigration(path: string, owner: string, migrationId: string): Promise<MigrationRecord | null> {
  const file = await load(path);
  return file?.owners[owner]?.[migrationId] ?? null;
}

/** Writes one migration. A ledger that cannot be read is replaced, since it cannot be trusted. */
export async function writeMigration(
  path: string,
  owner: string,
  migrationId: string,
  record: MigrationRecord,
): Promise<void> {
  let file: LedgerFile;
  try {
    file = (await load(path)) ?? emptyFile();
  } catch {
    file = emptyFile();
  }
  file.owners[owner] = { ...file.owners[owner], [migrationId]: { ...record, updatedAt: new Date().toISOString() } };
  await save(path, file);
}

export async function removeMigration(path: string, owner: string, migrationId: string): Promise<void> {
  let file: LedgerFile | null;
  try {
    file = await load(path);
  } catch {
    file = null;
  }
  if (!file) return;
  const entries = file.owners[owner];
  if (!entries || !(migrationId in entries)) return;
  delete entries[migrationId];
  if (Object.keys(entries).length === 0) delete file.owners[owner];
  if (Object.keys(file.owners).length === 0) {
    await rm(path, { force: true });
    return;
  }
  await save(path, file);
}
