/**
 * Instance transfer: move the agents and app settings of this computer to another OpenBot computer
 * with one `.zip` file. It is a different format from the Grok Bot agent import.
 *
 * Main writes and reads the file. The renderer never receives a path or the file's bytes: it names
 * agents and a token. No secret goes into the file: API keys, sign-ins, connector tokens and the
 * values of MCP variables and headers stay on the computer that made it.
 */

import { type AgentProviderId, isAgentProvider, isAgentProviderRef } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { type AvatarHue, isAvatarHue } from "./ipc-agent-identity";
import {
  AGENT_IMPORT_LIMITS,
  type AgentImportPreviewAgent,
  type AgentImportSkipped,
  decodeAgentImportPreviewAgent,
  decodeAgentImportSkipped,
  isAgentImportKey,
} from "./ipc-agent-import";
import { type ClientAgentSummary, isClientAgentSummary } from "./ipc-agents";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

export const INSTANCE_TRANSFER_LIMITS = {
  /** The file is read into memory on import, so it stays below 2 GiB. */
  archiveBytes: 2 * 1024 ** 3 - 1,
  files: 50_000,
  appVersion: 64,
} as const;

/** One agent on this computer, as the export screen lists it. */
export interface InstanceTransferAgent {
  id: string;
  name: string;
  title: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
  skillCount: number;
  routineCount: number;
  memoryCount: number;
  /** Workspace files that an export with files carries. */
  fileCount: number;
  fileBytes: number;
}

export interface InstanceTransferSummary {
  agents: InstanceTransferAgent[];
}

export interface ExportInstanceInput {
  agentIds: string[];
  includeFiles: boolean;
  includeSettings: boolean;
  /** Chat history is carried unless this is false. A reduced copy turns it off to fit a joined server. */
  includeHistory?: boolean;
}

/** Copy keeps the source; move archives it after the target confirms every item. */
export type CopyInstanceTransferMode = "copy" | "move";

/** A copy or move from one server to another, without a file dialog. */
export interface CopyInstanceTransferInput extends ExportInstanceInput {
  sourceServerId: string;
  targetServerId: string;
  mode: CopyInstanceTransferMode;
}

export interface InstanceExportResult {
  /** False when the user closed the save dialog. */
  saved: boolean;
  /** The name of the saved file, for display. `showExport` reveals it. */
  fileName: string | null;
  warnings: string[];
}

export interface InstanceTransferPreview {
  token: string;
  /** The OpenBot version that made the file. */
  appVersion: string;
  exportedAt: string | null;
  agents: AgentImportPreviewAgent[];
  /** The file carries app settings. */
  hasSettings: boolean;
  warnings: string[];
  /**
   * The target's ledger for this selection. Re-running the same selection resumes it instead of
   * creating duplicates. Null for a file the user picked directly.
   */
  migrationId: string | null;
}

export interface ApplyInstanceTransferInput {
  token: string;
  /** May be empty when only the settings are imported. */
  keys: string[];
  includeSettings: boolean;
}

export interface InstanceTransferMigration {
  id: string;
  /** True when this run found items an earlier run had already imported. */
  resumed: boolean;
}

export interface InstanceTransferResult {
  agents: ClientAgentSummary[];
  skipped: AgentImportSkipped[];
  /** Providers that were signed in on the other computer and are not signed in here. */
  signIn: AgentProviderId[];
  warnings: string[];
  /** Null for a file import, whose preview the user picked directly. */
  migration: InstanceTransferMigration | null;
}

/** Roll back the target items a migration created. */
export interface RollbackInstanceTransferInput {
  targetServerId: string;
  migrationId: string;
}

export interface RollbackInstanceTransferResult {
  /** Agents removed from the target. Settings the migration added are kept. */
  agents: number;
}

/** Archive the moved source items, then remove them from the source. */
export interface MoveInstanceSourceInput {
  sourceServerId: string;
  /** The target preview's migration id, which names the source bytes held for the move. */
  migrationId: string;
  agents: { id: string; name: string }[];
}

export interface MoveInstanceSourceResult {
  /** The saved transfer file, which the user can import again. */
  archiveFileName: string;
  /** The folder that holds the archive, for display. */
  archiveDirectory: string;
  movedAgentIds: string[];
  /** A source agent that could not be removed; its archive entry still exists. */
  retained: { agentId: string; name: string; reason: string }[];
  warnings: string[];
}

export interface ShowInstanceArchiveInput {
  archiveFileName: string;
}

/** How many secrets one transfer may carry, and the smallest set of bounds every side checks. */
export const INSTANCE_TRANSFER_SECRET_LIMITS = {
  items: 64,
  /** One sealed payload before its envelope; an item larger than this is not sent. */
  itemBytes: 8 * 1024,
  /** Every sealed payload of one transfer together. */
  totalBytes: 512 * 1024,
  /** How long the target keeps the key that may open one migration's secrets. */
  keyTtlMs: 5 * 60_000,
} as const;

/** The kinds of secret a transfer names. A sign-in this build cannot encrypt is listed, not sent. */
export const INSTANCE_TRANSFER_SECRET_KINDS = [
  "provider-key",
  "provider-sign-in",
  "mcp-values",
  "github",
  "onepassword",
  "custom-provider",
  "mcp-sign-in",
  "bitwarden",
] as const;

export type InstanceTransferSecretKind = (typeof INSTANCE_TRANSFER_SECRET_KINDS)[number];

export function isInstanceTransferSecretKind(value: unknown): value is InstanceTransferSecretKind {
  switch (value) {
    case "provider-key":
    case "provider-sign-in":
    case "mcp-values":
    case "github":
    case "onepassword":
    case "custom-provider":
    case "mcp-sign-in":
    case "bitwarden":
      return true;
    default:
      return false;
  }
}

/** Where the target asks the user to sign in again: the same sections the server settings open. */
export const INSTANCE_TRANSFER_SECRET_SECTIONS = ["providers", "mcp", "connectors"] as const;

export type InstanceTransferSecretSection = (typeof INSTANCE_TRANSFER_SECRET_SECTIONS)[number];

export function isInstanceTransferSecretSection(value: unknown): value is InstanceTransferSecretSection {
  switch (value) {
    case "providers":
    case "mcp":
    case "connectors":
      return true;
    default:
      return false;
  }
}

/**
 * One secret the source holds, described without its value. `transferable` is false when the value
 * cannot safely move or the target must sign in again.
 */
export interface InstanceTransferSecretSummary {
  id: string;
  kind: InstanceTransferSecretKind;
  /** The provider, MCP server or connector name the target shows. */
  label: string;
  /** How many stored values the item carries: one key, or every variable of one MCP server. */
  count: number;
  section: InstanceTransferSecretSection;
  transferable: boolean;
}

export interface InstanceTransferSecretsSummary {
  items: InstanceTransferSecretSummary[];
}

/** What became of one secret. A failed item stays on the source and is shown for re-authentication. */
export type InstanceTransferSecretStatus = "transferred" | "already-present" | "target-missing" | "failed";

export interface InstanceTransferSecretOutcome {
  id: string;
  kind: InstanceTransferSecretKind;
  label: string;
  status: InstanceTransferSecretStatus;
  /** A sentence for the completion summary: why it failed or where it already existed. */
  reason: string | null;
}

export interface InstanceTransferSecretsResult {
  outcomes: InstanceTransferSecretOutcome[];
}

/** Move the selected secrets of `sourceServerId` into an applied migration on `targetServerId`. */
export interface TransferInstanceSecretsInput {
  sourceServerId: string;
  targetServerId: string;
  /** The target migration the secrets belong to; it must be in the target's ledger. */
  migrationId: string;
  secretIds: string[];
}

/**
 * One secret encrypted for one migration. Main only: the renderer never receives this, and only
 * the target's in-memory key can open it. `publicKey`, `salt`, `nonce` and `ciphertext` are base64.
 */
export interface InstanceTransferSealedItem {
  id: string;
  kind: InstanceTransferSecretKind;
  label: string;
  /** The source's ephemeral X25519 public key. */
  publicKey: string;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export interface SealInstanceTransferSecretsResult {
  items: InstanceTransferSealedItem[];
  /** A selected item the source could not seal; it stays on the source. */
  failed: { id: string; reason: string }[];
}

/** The name this computer gives a move's source archive, which `showArchive` may reveal. */
const INSTANCE_ARCHIVE_FILE = /^openbot-transfer-move-[\da-f]{64}\.zip$/u;

export function isInstanceArchiveFileName(value: unknown): value is string {
  return typeof value === "string" && INSTANCE_ARCHIVE_FILE.test(value);
}

function invalid(label: string): never {
  throw new Error(`Invalid ${label}.`);
}

function record(value: unknown, label: string) {
  if (!isDynamicRecord(value)) invalid(label);
  return value;
}

function count(value: unknown, label: string): number {
  if (!isNumber(value) || !Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}

function messages(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > AGENT_IMPORT_LIMITS.warnings ||
    !value.every((item) => isBoundedString(item, AGENT_IMPORT_LIMITS.message))
  )
    invalid(label);
  return value;
}

function isUniqueList<T extends string>(
  value: unknown,
  maximum: number,
  item: (entry: unknown) => entry is T,
): value is T[] {
  return Array.isArray(value) && value.length <= maximum && value.every(item) && new Set(value).size === value.length;
}

export function parseExportInstanceInput(value: unknown): ExportInstanceInput {
  const input = record(value, "export request");
  if (!isUniqueList(input.agentIds, INPUT_LIMITS.agents, isIdentifier) || input.agentIds.length === 0)
    invalid("agent selection");
  if (!isBoolean(input.includeFiles) || !isBoolean(input.includeSettings)) invalid("export request");
  if (input.includeHistory !== undefined && !isBoolean(input.includeHistory)) invalid("export request");
  return {
    agentIds: input.agentIds,
    includeFiles: input.includeFiles,
    includeSettings: input.includeSettings,
    ...(input.includeHistory === undefined ? {} : { includeHistory: input.includeHistory }),
  };
}

export function parseCopyInstanceTransferInput(value: unknown): CopyInstanceTransferInput {
  const input = record(value, "copy request");
  if (!isIdentifier(input.sourceServerId) || !isIdentifier(input.targetServerId)) invalid("copy request");
  if (input.sourceServerId === input.targetServerId) invalid("copy request");
  if (input.mode !== "copy" && input.mode !== "move") invalid("copy request");
  return {
    ...parseExportInstanceInput(value),
    sourceServerId: input.sourceServerId,
    targetServerId: input.targetServerId,
    mode: input.mode,
  };
}

export function parseRollbackInstanceTransferInput(value: unknown): RollbackInstanceTransferInput {
  const input = record(value, "rollback request");
  if (!isIdentifier(input.targetServerId) || !isIdentifier(input.migrationId)) invalid("rollback request");
  return { targetServerId: input.targetServerId, migrationId: input.migrationId };
}

/** The source agents to archive and remove, by id and name, after the target confirms. */
export function parseMoveInstanceSourceInput(value: unknown): MoveInstanceSourceInput {
  const input = record(value, "move request");
  if (!isIdentifier(input.sourceServerId) || !isIdentifier(input.migrationId)) invalid("move request");
  if (!Array.isArray(input.agents) || input.agents.length > INPUT_LIMITS.agents) invalid("move request");
  const agents = input.agents.map((entry) => {
    const agent = record(entry, "move agent");
    if (!isIdentifier(agent.id) || !isBoundedString(agent.name, INPUT_LIMITS.agentName)) invalid("move agent");
    return { id: agent.id, name: agent.name };
  });
  if (new Set(agents.map((agent) => agent.id)).size !== agents.length) invalid("move request");
  return { sourceServerId: input.sourceServerId, migrationId: input.migrationId, agents };
}

export function parseShowInstanceArchiveInput(value: unknown): ShowInstanceArchiveInput {
  const input = record(value, "archive request");
  if (!isInstanceArchiveFileName(input.archiveFileName)) invalid("archive request");
  return { archiveFileName: input.archiveFileName };
}

export function parseTransferInstanceSecretsInput(value: unknown): TransferInstanceSecretsInput {
  const input = record(value, "secrets request");
  if (
    !isIdentifier(input.sourceServerId) ||
    !isIdentifier(input.targetServerId) ||
    input.sourceServerId === input.targetServerId ||
    !isIdentifier(input.migrationId)
  )
    invalid("secrets request");
  if (
    !isUniqueList(input.secretIds, INSTANCE_TRANSFER_SECRET_LIMITS.items, isIdentifier) ||
    input.secretIds.length === 0
  )
    invalid("secrets selection");
  return {
    sourceServerId: input.sourceServerId,
    targetServerId: input.targetServerId,
    migrationId: input.migrationId,
    secretIds: input.secretIds,
  };
}

export function parseApplyInstanceTransferInput(value: unknown): ApplyInstanceTransferInput {
  const input = record(value, "import request");
  if (!isIdentifier(input.token)) invalid("import token");
  if (!isUniqueList(input.keys, INPUT_LIMITS.agents, isAgentImportKey)) invalid("agent selection");
  if (!isBoolean(input.includeSettings)) invalid("import request");
  if (input.keys.length === 0 && !input.includeSettings) invalid("import request");
  return { token: input.token, keys: input.keys, includeSettings: input.includeSettings };
}

function decodeTransferAgent(value: unknown): InstanceTransferAgent {
  const agent = record(value, "transfer agent");
  if (
    !isIdentifier(agent.id) ||
    !isBoundedString(agent.name, INPUT_LIMITS.agentName) ||
    !isBoundedString(agent.title, INPUT_LIMITS.agentTitle) ||
    !isString(agent.avatarSeed) ||
    !(agent.avatarHue === null || isAvatarHue(agent.avatarHue)) ||
    !isNullableBoundedString(agent.avatarUrl, 2048)
  )
    invalid("transfer agent");
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    avatarUrl: agent.avatarUrl,
    skillCount: count(agent.skillCount, "transfer agent"),
    routineCount: count(agent.routineCount, "transfer agent"),
    memoryCount: count(agent.memoryCount, "transfer agent"),
    fileCount: count(agent.fileCount, "transfer agent"),
    fileBytes: count(agent.fileBytes, "transfer agent"),
  };
}

export function decodeInstanceTransferSummary(value: unknown): InstanceTransferSummary {
  const summary = record(value, "transfer summary");
  if (!Array.isArray(summary.agents) || summary.agents.length > INPUT_LIMITS.agents) invalid("transfer summary");
  return { agents: summary.agents.map(decodeTransferAgent) };
}

export function decodeInstanceExportResult(value: unknown): InstanceExportResult {
  const result = record(value, "export result");
  if (!isBoolean(result.saved) || !isNullableBoundedString(result.fileName, 255)) invalid("export result");
  return { saved: result.saved, fileName: result.fileName, warnings: messages(result.warnings, "export warnings") };
}

export function decodeInstanceTransferPreview(value: unknown): InstanceTransferPreview | null {
  if (value === null) return null;
  const preview = record(value, "transfer preview");
  if (
    !isIdentifier(preview.token) ||
    !isBoundedString(preview.appVersion, INSTANCE_TRANSFER_LIMITS.appVersion) ||
    !isNullableBoundedString(preview.exportedAt, 64) ||
    !Array.isArray(preview.agents) ||
    preview.agents.length > INPUT_LIMITS.agents ||
    !isBoolean(preview.hasSettings) ||
    !(preview.migrationId === null || isIdentifier(preview.migrationId))
  )
    invalid("transfer preview");
  return {
    token: preview.token,
    appVersion: preview.appVersion,
    exportedAt: preview.exportedAt,
    agents: preview.agents.map(decodeAgentImportPreviewAgent),
    hasSettings: preview.hasSettings,
    warnings: messages(preview.warnings, "transfer warnings"),
    migrationId: preview.migrationId,
  };
}

/** The preview a copy must produce. Only `choose`, where the user may pick no file, returns null. */
export function decodeRequiredInstanceTransferPreview(value: unknown): InstanceTransferPreview {
  const preview = decodeInstanceTransferPreview(value);
  if (preview === null) invalid("transfer preview");
  return preview;
}

function decodeMigration(value: unknown): InstanceTransferMigration {
  const migration = record(value, "transfer migration");
  if (!isIdentifier(migration.id) || !isBoolean(migration.resumed)) invalid("transfer migration");
  return { id: migration.id, resumed: migration.resumed };
}

export function decodeInstanceTransferResult(value: unknown): InstanceTransferResult {
  const result = record(value, "transfer result");
  if (!Array.isArray(result.agents) || !result.agents.every(isClientAgentSummary)) invalid("transfer result");
  if (!isUniqueList(result.signIn, 32, isAgentProvider)) invalid("transfer result");
  if (!(result.migration === null || isDynamicRecord(result.migration))) invalid("transfer result");
  return {
    agents: result.agents,
    skipped: decodeAgentImportSkipped(result.skipped, "skipped agent"),
    signIn: result.signIn,
    warnings: messages(result.warnings, "transfer warnings"),
    migration: result.migration === null ? null : decodeMigration(result.migration),
  };
}

export function decodeRollbackInstanceTransferResult(value: unknown): RollbackInstanceTransferResult {
  const result = record(value, "rollback result");
  return { agents: count(result.agents, "rollback result") };
}

export function decodeMoveInstanceSourceResult(value: unknown): MoveInstanceSourceResult {
  const result = record(value, "move result");
  if (
    !isInstanceArchiveFileName(result.archiveFileName) ||
    !isBoundedString(result.archiveDirectory, 4096) ||
    !Array.isArray(result.movedAgentIds) ||
    result.movedAgentIds.length > INPUT_LIMITS.agents ||
    !result.movedAgentIds.every(isIdentifier) ||
    !Array.isArray(result.retained) ||
    result.retained.length > INPUT_LIMITS.agents
  )
    invalid("move result");
  return {
    archiveFileName: result.archiveFileName,
    archiveDirectory: result.archiveDirectory,
    movedAgentIds: result.movedAgentIds,
    retained: result.retained.map((entry) => {
      const item = record(entry, "retained agent");
      if (
        !isIdentifier(item.agentId) ||
        !isBoundedString(item.name, INPUT_LIMITS.agentName) ||
        !isBoundedString(item.reason, AGENT_IMPORT_LIMITS.message)
      )
        invalid("retained agent");
      return { agentId: item.agentId, name: item.name, reason: item.reason };
    }),
    warnings: messages(result.warnings, "move warnings"),
  };
}

function decodeSecretSummary(value: unknown): InstanceTransferSecretSummary {
  const item = record(value, "transfer secret");
  if (
    !isIdentifier(item.id) ||
    !isInstanceTransferSecretKind(item.kind) ||
    !isBoundedString(item.label, 2048) ||
    !isInstanceTransferSecretSection(item.section) ||
    typeof item.transferable !== "boolean"
  )
    invalid("transfer secret");
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    count: count(item.count, "transfer secret"),
    section: item.section,
    transferable: item.transferable,
  };
}

export function decodeInstanceTransferSecretsSummary(value: unknown): InstanceTransferSecretsSummary {
  const summary = record(value, "secrets summary");
  if (!Array.isArray(summary.items) || summary.items.length > INSTANCE_TRANSFER_SECRET_LIMITS.items)
    invalid("secrets summary");
  return { items: summary.items.map(decodeSecretSummary) };
}

function decodeSecretOutcome(value: unknown): InstanceTransferSecretOutcome {
  const item = record(value, "secret outcome");
  if (
    !isIdentifier(item.id) ||
    !isInstanceTransferSecretKind(item.kind) ||
    !isBoundedString(item.label, 2048) ||
    (item.status !== "transferred" &&
      item.status !== "already-present" &&
      item.status !== "target-missing" &&
      item.status !== "failed") ||
    !(item.reason === null || isBoundedString(item.reason, AGENT_IMPORT_LIMITS.message))
  )
    invalid("secret outcome");
  return { id: item.id, kind: item.kind, label: item.label, status: item.status, reason: item.reason };
}

export function decodeInstanceTransferSecretsResult(value: unknown): InstanceTransferSecretsResult {
  const result = record(value, "secrets result");
  if (!Array.isArray(result.outcomes) || result.outcomes.length > INSTANCE_TRANSFER_SECRET_LIMITS.items)
    invalid("secrets result");
  return { outcomes: result.outcomes.map(decodeSecretOutcome) };
}

function decodeBase64(value: unknown, bytes: number | null, label: string): string {
  if (typeof value !== "string" || value.length > (bytes === null ? 16_384 : 64)) invalid(label);
  if (bytes !== null && value.length !== Math.ceil(bytes / 3) * 4) invalid(label);
  return value;
}

function decodeSealedItem(value: unknown): InstanceTransferSealedItem {
  const item = record(value, "sealed secret");
  if (!isIdentifier(item.id) || !isInstanceTransferSecretKind(item.kind) || !isBoundedString(item.label, 2048))
    invalid("sealed secret");
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    publicKey: decodeBase64(item.publicKey, 32, "sealed secret"),
    salt: decodeBase64(item.salt, 16, "sealed secret"),
    nonce: decodeBase64(item.nonce, 12, "sealed secret"),
    ciphertext: decodeBase64(item.ciphertext, null, "sealed secret"),
  };
}

export function decodeSealInstanceTransferSecretsResult(value: unknown): SealInstanceTransferSecretsResult {
  const result = record(value, "sealed secrets");
  if (
    !Array.isArray(result.items) ||
    result.items.length > INSTANCE_TRANSFER_SECRET_LIMITS.items ||
    !Array.isArray(result.failed) ||
    result.failed.length > INSTANCE_TRANSFER_SECRET_LIMITS.items
  )
    invalid("sealed secrets");
  return {
    items: result.items.map(decodeSealedItem),
    failed: result.failed.map((entry) => {
      const item = record(entry, "sealed failure");
      if (!isIdentifier(item.id) || !isBoundedString(item.reason, AGENT_IMPORT_LIMITS.message))
        invalid("sealed failure");
      return { id: item.id, reason: item.reason };
    }),
  };
}

/** The target's public key for one migration, base64. */
export function decodeInstanceTransferSecretKey(value: unknown): string {
  const result = record(value, "secret key");
  return decodeBase64(result.publicKey, 32, "secret key");
}

/** A remote host's summary: `instance-transfer-v1` carries no avatar addresses. */
export function decodeRemoteInstanceTransferSummary(value: unknown): InstanceTransferSummary {
  const summary = record(value, "transfer summary");
  if (!Array.isArray(summary.agents)) invalid("transfer summary");
  return decodeInstanceTransferSummary({
    agents: summary.agents.map((agent) => ({ ...record(agent, "transfer agent"), avatarUrl: null })),
  });
}

/** A remote host's preview: `instance-transfer-v1` carries no avatars. */
export function decodeRemoteInstanceTransferPreview(value: unknown): InstanceTransferPreview {
  const preview = record(value, "transfer preview");
  if (!Array.isArray(preview.agents)) invalid("transfer preview");
  const decoded = decodeInstanceTransferPreview({
    ...preview,
    migrationId: preview.migrationId ?? null,
    agents: preview.agents.map((agent) => ({ ...record(agent, "transfer agent"), avatarUrl: null })),
  });
  if (!decoded) invalid("transfer preview");
  return decoded;
}

/** A remote host's result: the new agents by id and name. */
export interface RemoteInstanceTransferResult extends Omit<InstanceTransferResult, "agents"> {
  agents: { agentId: string; name: string }[];
}

export function decodeRemoteInstanceTransferResult(value: unknown): RemoteInstanceTransferResult {
  const result = record(value, "transfer result");
  if (!Array.isArray(result.agents)) invalid("transfer result");
  const agents = result.agents.map((item) => {
    const entry = record(item, "transferred agent");
    if (!isIdentifier(entry.agentId) || !isBoundedString(entry.name, INPUT_LIMITS.agentName))
      invalid("transferred agent");
    return { agentId: entry.agentId, name: entry.name };
  });
  // A newer host can name a provider that this OpenBot does not know. Its sign-in cannot start here.
  if (!isUniqueList(result.signIn, 32, isAgentProviderRef)) invalid("transfer result");
  const signIn = result.signIn.filter(isAgentProvider);
  // `instance-transfer-v1` has no migration; a v2 host adds it.
  return {
    ...decodeInstanceTransferResult({ ...result, agents: [], signIn, migration: result.migration ?? null }),
    agents,
  };
}

/** The remote result, with the new agents read from the host's agent list. */
export function resolveRemoteInstanceTransferResult(
  result: RemoteInstanceTransferResult,
  agents: readonly ClientAgentSummary[],
): InstanceTransferResult {
  const ids = new Set(result.agents.map((agent) => agent.agentId));
  return { ...result, agents: agents.filter((agent) => ids.has(agent.id)) };
}
