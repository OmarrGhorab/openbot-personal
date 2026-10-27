// Instance transfer: the agents and app settings of this computer in one `.zip` file, and the import
// of such a file on another computer. See `docs/architecture/instance-transfer.md`.
//
// No secret goes into the file. MCP variable and header values are emptied, custom providers lose
// their keys, custom agents keep only the names of their variables, and sign-ins are recorded as
// provider ids only. Imported agents get this computer's approval rules: the file carries no access,
// Computer Use, automation or auto-approve setting.
//
// Each agent is created through the same services the user reaches by hand. When one step fails,
// that agent is deleted and reported, and the other agents continue. Settings add what is missing
// here and never replace an MCP server, provider or custom agent that this computer has.

import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_IMPORT_LIMITS,
  type AgentImportPreviewAgent,
  type AgentImportSkipped,
  type AgentMemory,
  type AgentMemorySelectionState,
  type AgentModelOption,
  type AgentSummary,
  type ApplyInstanceTransferInput,
  AVATAR_SEED_PATTERN,
  type AvatarImageInput,
  type ConnectRoutineFlowInput,
  type CreateAgentInput,
  type CreateRoutineInput,
  type CustomAgentSummary,
  type CustomProviderSummary,
  type ExportInstanceInput,
  INSTANCE_TRANSFER_LIMITS,
  type InstanceExportResult,
  type InstanceTransferAgent,
  type InstanceTransferPreview,
  type InstanceTransferResult,
  type InstanceTransferSummary,
  isAgentImportKey,
  isInstanceArchiveFileName,
  type McpServerConfig,
  type Routine,
  type RoutineFlowLink,
  type SaveCustomProviderInput,
  type SetAgentMemoryInclusionInput,
  type SidebarLayoutAction,
  type SidebarLayoutSnapshot,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { INSTANCE_TRANSFER_REMOTE_BYTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Exit, Result, Semaphore } from "effect";
import { Zip, ZipPassThrough, zipSync } from "fflate";
import { isMissingFileError } from "../backend/file-errors";
import { isPathInside } from "../backend/path-containment";
import {
  type ArchiveLimits,
  avatarImage,
  executableEntries,
  extract,
  isUnsafeEntry,
  listEntries,
  readArchiveEffect,
  sha256,
  writeImportedFilesEffect,
  writeTreeEffect,
} from "./agent-archive";
import type { AgentImportSkills } from "./agent-import-service";
import { validTimezone } from "./agent-marketplace-service";
import { type ArchiveOperationError, archiveCall, archiveFailure, archiveSync } from "./archive-effects";
import {
  type MigrationRecord,
  migrationIdFor,
  readMigration,
  removeMigration,
  writeMigration,
} from "./instance-transfer-ledger";
import {
  agentPrefix,
  decodeTransferManifest,
  INSTANCE_TRANSFER_FORMAT,
  INSTANCE_TRANSFER_MANIFEST,
  INSTANCE_TRANSFER_VERSION,
  SHARED_FOLDER,
  type TransferAgent,
  type TransferManifest,
  type TransferManifestFile,
  type TransferSettings,
} from "./instance-transfer-manifest";
import { MANAGED_SKILL_FOLDERS, OWNERSHIP_MARKER } from "./managed-skill-service";
import { inspectArchive, isUnsafeArchivePath } from "./skill-package";

const ARCHIVE: ArchiveLimits = {
  archiveBytes: INSTANCE_TRANSFER_LIMITS.archiveBytes,
  files: INSTANCE_TRANSFER_LIMITS.files,
  tooLarge: sourceText("error.import.transferTooLarge"),
  expandedTooLarge: sourceText("error.import.transferTooLarge"),
  invalid: sourceText("error.import.transferNotFile"),
};
/**
 * `Data/` in `~/OpenBot/Shared` holds the shared tables database. It is open while the app runs, and
 * its owner records name agent ids of this computer, so a transfer never copies it.
 */
const SHARED_DATA = "data";
/** A file sent to or from a member of a joined client: one WebRTC file transfer. */
const REMOTE_ARCHIVE: ArchiveLimits = {
  archiveBytes: INSTANCE_TRANSFER_REMOTE_BYTES,
  files: INSTANCE_TRANSFER_LIMITS.files,
  tooLarge: sourceText("error.import.transferRemoteTooLarge"),
  expandedTooLarge: sourceText("error.import.transferRemoteTooLarge"),
  invalid: sourceText("error.import.transferNotFile"),
};
/** The owner of the files the local user reads. A member's owner is the member id. */
const LOCAL_OWNER = "local";
/** A file that a member sent and nobody applied is removed after this. */
const UPLOAD_TTL_MS = 30 * 60_000;
/** Skill folders are copied here, published to the local library, and removed again. */
const SKILL_STAGING = ".openbot/import-skills";
/** Workspace folders an export leaves out: OpenBot's own state and the installed skills, which travel as skills. */
const WORKSPACE_SKIPPED = [".openbot", ...MANAGED_SKILL_FOLDERS];
const AVATAR_EXTENSIONS: Record<AvatarImageInput["mimeType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The agent operations a transfer uses, as `AgentService` offers them. */
interface InstanceTransferAgents {
  listAgents(): AgentSummary[];
  listRoutines(agentId: string): Routine[];
  listMemories(agentId: string): AgentMemory[];
  getMemorySelection(agentId: string): Pick<AgentMemorySelectionState, "selections">;
  setMemoryInclusion(input: SetAgentMemoryInclusionInput): unknown;
  resolveAvatar(agentId: string): { path: string; mimeType: AvatarImageInput["mimeType"] } | null;
  listModels(): Array<Pick<AgentModelOption, "provider" | "id">>;
  createAgentProfile(
    input: Omit<CreateAgentInput, "initialMessage"> & { title?: string },
  ): Effect.Effect<AgentSummary, unknown>;
  updateAgent(input: UpdateAgentInput): Effect.Effect<AgentSummary, unknown>;
  createRoutine(input: CreateRoutineInput, options?: { recordConversationEvent?: boolean }): Pick<Routine, "id">;
  createMemory(input: { agentId: string; text: string }): Pick<AgentMemory, "id">;
  memoryLimit(): number;
  initializeMemorySelection(agentId: string): void;
  setAvatar(agentId: string, image: AvatarImageInput | null): Effect.Effect<AgentSummary, unknown>;
  deleteAgent(agentId: string): Effect.Effect<void, unknown>;
}

/** The server settings an export reads and an import writes. Main wires each to its owner. */
interface InstanceTransferSettings {
  mcpServers(): McpServerConfig[];
  saveMcpServer(config: McpServerConfig): Effect.Effect<unknown, unknown>;
  customProviders(): CustomProviderSummary[];
  saveCustomProvider(input: SaveCustomProviderInput): Effect.Effect<unknown, unknown>;
  customAgents(): Effect.Effect<CustomAgentSummary[], unknown>;
  /** Read only: an agent keeps its model only when its provider is on. */
  providersOff(): readonly AgentProviderId[];
  sidebar(): SidebarLayoutSnapshot;
  mutateSidebar(action: SidebarLayoutAction): Effect.Effect<SidebarLayoutSnapshot, unknown>;
  routineFlowLinks(agentId: string): Effect.Effect<RoutineFlowLink[], unknown>;
  connectRoutineFlow(input: ConnectRoutineFlowInput): Effect.Effect<unknown, unknown>;
  /** Removes an agent from the sidebar after a rollback or a move deletes it. */
  removeAgent(agentId: string): Effect.Effect<unknown, unknown>;
  /** Providers that are signed in and ready on this computer. */
  signedInProviders(): AgentProviderId[];
}

export interface InstanceTransferOptions {
  agents: InstanceTransferAgents;
  skills: AgentImportSkills;
  settings: InstanceTransferSettings;
  /** `~/OpenBot/Shared`. */
  sharedRoot: string;
  appVersion: string;
  /** Where a file sent by a member of a joined client, or made for one, waits. */
  uploadDirectory?: string;
  /** The target's record of each migration, under user data. */
  migrationLedgerPath: string;
  /** Source archives held after staging a move, until the target confirms. */
  moveDirectory: string;
  /** Where a confirmed move leaves its reversible source archive, `~/OpenBot/Archives`. */
  archiveDirectory: string;
  timezone?: () => string;
  now?: () => Date;
}

interface FileEntry {
  /** The path inside the archive folder, with `/`. */
  name: string;
  path: string;
  size: number;
  executable: boolean;
}

interface StagedTransfer {
  token: string;
  /** Only the owner can apply or discard the token: the local user or one member. */
  owner: string;
  /** A file the service wrote for a member, removed when the token ends. */
  temporary: boolean;
  path: string;
  sha256: string;
  manifest: TransferManifest;
  avatars: Map<string, AvatarImageInput>;
  /** True when a copy or move staged it, so the target ledger can resume and roll it back. */
  migrate: boolean;
}

/** The ledger of the migration an apply is running, shared by the agents it creates. */
interface MigrationContext {
  owner: string;
  id: string;
  record: MigrationRecord;
}

export class InstanceTransferService {
  readonly #staged = new Map<string, StagedTransfer>();
  /** One ledger write at a time, so two applies cannot lose each other's entries. */
  readonly #ledger = Semaphore.makeUnsafe(1);
  readonly #timezone: () => string;
  readonly #now: () => Date;
  #uploadDirectoryReady: Deferred.Deferred<void, ArchiveOperationError> | null = null;

  constructor(private readonly options: InstanceTransferOptions) {
    this.#timezone = options.timezone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    this.#now = options.now ?? (() => new Date());
  }

  /** What each agent would carry: the export screen shows it before anything is written. */
  readonly summary = Effect.fn("InstanceTransfer.summary")(function* (
    this: InstanceTransferService,
  ): Effect.fn.Return<InstanceTransferSummary, ArchiveOperationError> {
    const agents: InstanceTransferAgent[] = [];
    for (const agent of this.options.agents.listAgents()) {
      // The counts are a preview: a folder that cannot be read stops the export, not this screen,
      // so an export without files stays possible.
      const files = yield* workspaceFiles(agent.workspacePath).pipe(Effect.orElseSucceed(() => []));
      const skills = yield* skillFolders(agent.workspacePath).pipe(Effect.orElseSucceed(() => []));
      agents.push({
        id: agent.id,
        name: agent.name,
        title: agent.title,
        avatarSeed: agent.avatarSeed,
        avatarHue: agent.avatarHue,
        avatarUrl: agent.avatarUrl,
        skillCount: skills.length,
        routineCount: this.options.agents.listRoutines(agent.id).length,
        memoryCount: this.options.agents.listMemories(agent.id).length,
        fileCount: files.length,
        fileBytes: files.reduce((total, file) => total + file.size, 0),
      });
    }
    return { agents };
  }).bind(this);

  /** Writes the export to `path`. The file appears only when it is complete. */
  readonly exportTo = Effect.fn("InstanceTransfer.export")(function* (
    this: InstanceTransferService,
    path: string,
    input: ExportInstanceInput,
    limits: ArchiveLimits = ARCHIVE,
  ): Effect.fn.Return<InstanceExportResult, ArchiveOperationError> {
    const all = this.options.agents.listAgents();
    const selected = input.agentIds.map((id) => all.find((agent) => agent.id === id));
    if (selected.some((agent) => !agent))
      return yield* archiveFailure(new Error(sourceText("error.import.agentNotInExport")));
    const agents = selected.filter((agent): agent is AgentSummary => agent !== undefined);

    const entries: ZipEntry[] = [];
    const warnings: string[] = [];
    const keys = new Map<string, string>();
    const manifestAgents: TransferAgent[] = [];
    let bytes = 0;
    for (const [index, agent] of agents.entries()) {
      const key = isAgentImportKey(agent.id) ? agent.id : `agent-${index + 1}`;
      keys.set(agent.id, key);
      const prefix = agentPrefix(key);

      let avatar: string | null = null;
      const resolved = this.options.agents.resolveAvatar(agent.id);
      if (resolved) {
        avatar = `${prefix}avatar.${AVATAR_EXTENSIONS[resolved.mimeType]}`;
        const avatarPath = resolved.path;
        entries.push({ name: avatar, read: () => readFile(avatarPath) });
      }

      const skills: string[] = [];
      // An import refuses an agent with more skills than the limit, so the export keeps the first ones.
      const folders = yield* skillFolders(agent.workspacePath);
      if (folders.length > INPUT_LIMITS.agentSkills)
        warnings.push(
          sourceText("error.import.transferSkillLimit", {
            name: agent.name,
            limit: INPUT_LIMITS.agentSkills,
            total: folders.length,
          }),
        );
      for (const skill of folders.slice(0, INPUT_LIMITS.agentSkills)) {
        const folder = `${prefix}skills/${skill.slug}`;
        skills.push(folder);
        for (const file of skill.files) {
          bytes += file.size;
          entries.push({ name: `${folder}/${file.name}`, read: () => readFile(file.path) });
        }
      }

      let files: string | null = null;
      if (input.includeFiles) {
        const workspace = yield* workspaceFiles(agent.workspacePath);
        if (workspace.length > 0) {
          files = `${prefix}workspace`;
          for (const file of workspace) {
            bytes += file.size;
            entries.push({
              name: `${files}/${file.name}`,
              read: () => readFile(file.path),
              executable: file.executable,
            });
          }
        }
      }

      const routines: TransferAgent["routines"][number][] = this.options.agents
        .listRoutines(agent.id)
        .map((routine) => ({
          key: routine.id,
          name: routine.name,
          instruction: routine.instruction,
          active: routine.active,
          timezone: routine.timezone,
          schedule: routine.trigger.schedule,
          ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
          ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
        }));
      const oneTimeRoutines = routines.filter((routine) => routine.schedule.kind === "once");

      const selections = new Map(
        this.options.agents
          .getMemorySelection(agent.id)
          .selections.filter((selection) => selection.userControlled)
          .map((selection) => [selection.memoryId, selection.inclusion] as const),
      );
      manifestAgents.push({
        key,
        name: agent.name,
        title: agent.title,
        description: agent.description,
        avatarSeed: agent.avatarSeed,
        avatarHue: agent.avatarHue,
        avatar,
        provider: agent.provider,
        model: agent.model,
        reasoningEffort: agent.reasoningEffort,
        notifications: agent.notifications,
        ...(agent.busyMessageMode ? { busyMessageMode: agent.busyMessageMode } : {}),
        ...(agent.taskLimit === undefined ? {} : { taskLimit: agent.taskLimit }),
        skills,
        files,
        routines: routines.filter((routine) => routine.schedule.kind !== "once"),
        ...(oneTimeRoutines.length > 0 ? { oneTimeRoutines } : {}),
        memories: this.options.agents.listMemories(agent.id).map((memory) => {
          const inclusion = selections.get(memory.id);
          return { text: memory.text, ...(inclusion ? { inclusion } : {}) };
        }),
      });
    }

    let shared: typeof SHARED_FOLDER | null = null;
    if (input.includeFiles) {
      const sharedFiles = yield* walk(this.options.sharedRoot, isSharedData);
      if (sharedFiles.length > 0) shared = SHARED_FOLDER;
      for (const file of sharedFiles) {
        bytes += file.size;
        entries.push({
          name: `${SHARED_FOLDER}/${file.name}`,
          read: () => readFile(file.path),
          executable: file.executable,
        });
      }
    }
    if (entries.length + 1 > limits.files || bytes > limits.archiveBytes)
      return yield* archiveFailure(new Error(limits.tooLarge));

    const manifest: TransferManifestFile = {
      format: INSTANCE_TRANSFER_FORMAT,
      version: INSTANCE_TRANSFER_VERSION,
      source: { appVersion: this.options.appVersion, exportedAt: this.#now().toISOString() },
      agents: manifestAgents,
      settings: input.includeSettings ? yield* this.#readSettings(keys, manifestAgents) : null,
      shared,
      signedIn: this.options.settings.signedInProviders(),
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    entries.unshift({ name: INSTANCE_TRANSFER_MANIFEST, read: () => Promise.resolve(manifestBytes) });
    const gone = yield* writeZipEffect(path, entries);
    return {
      saved: true,
      fileName: basename(path),
      warnings: gone > 0 ? [...warnings, sourceText("error.import.transferFilesGone", { number: gone })] : warnings,
    };
  }).bind(this);

  /**
   * Writes an export for a member of a joined client to a new file in the upload folder. The caller
   * sends it and removes it. The file stays under what one WebRTC file transfer can carry.
   */
  readonly exportForMember = Effect.fn("InstanceTransfer.exportForMember")(function* (
    this: InstanceTransferService,
    input: ExportInstanceInput,
  ): Effect.fn.Return<string, ArchiveOperationError> {
    const directory = this.options.uploadDirectory;
    if (!directory) return yield* archiveFailure(new Error("Instance transfer uploads are not available."));
    yield* this.#prepareUploadDirectory(directory);
    const path = join(directory, `${randomUUID()}.zip`);
    yield* this.exportTo(path, input, REMOTE_ARCHIVE).pipe(
      Effect.tapError(() => archiveCall(() => rm(path, { force: true })).pipe(Effect.ignore)),
    );
    return path;
  }).bind(this);

  readonly #readSettings = Effect.fn("InstanceTransfer.readSettings")(function* (
    this: InstanceTransferService,
    keys: ReadonlyMap<string, string>,
    agents: readonly TransferAgent[],
  ): Effect.fn.Return<TransferSettings, ArchiveOperationError> {
    const settings = this.options.settings;
    const layout = settings.sidebar();
    const routineKeys = new Set(agents.flatMap((agent) => transferRoutines(agent).map((routine) => routine.key)));
    const links = new Map<string, RoutineFlowLink>();
    for (const agentId of keys.keys())
      for (const link of yield* settings.routineFlowLinks(agentId).pipe(Effect.mapError(failure)))
        links.set(link.id, link);
    const redact = createRedaction();
    const order = [
      ...layout.agentOrder,
      ...Object.keys(layout.agentAssignments).filter((id) => !layout.agentOrder.includes(id)),
    ];
    return {
      mcpServers: settings.mcpServers().map((server) => ({
        ...server,
        id: "",
        args: redact.args(server.name, server.args),
        url: redact.origin(server.name, server.url),
        env: server.env.map(({ key }) => ({ key, value: "" })),
        headers: server.headers.map(({ key }) => ({ key, value: "" })),
      })),
      customProviders: settings.customProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: redact.url(provider.name, provider.baseUrl),
        models: provider.models,
        needsApiKey: provider.hasApiKey,
      })),
      customAgents: (yield* settings.customAgents().pipe(Effect.mapError(failure))).map((agent) => ({
        id: agent.id,
        name: agent.name,
        command: agent.command,
        args: redact.args(agent.name, agent.args),
        envNames: agent.envNames,
      })),
      sidebarSections: layout.sections.map((section) => ({
        name: section.name,
        agentKeys: order.flatMap((agentId) => {
          const key = keys.get(agentId);
          return key && layout.agentAssignments[agentId] === section.id ? [key] : [];
        }),
      })),
      routineFlows: [...links.values()].flatMap((link) => {
        const fromAgentKey = keys.get(link.fromAgentId);
        const toAgentKey = keys.get(link.toAgentId);
        return fromAgentKey && toAgentKey && routineKeys.has(link.routineId)
          ? [{ routineKey: link.routineId, fromAgentKey, toAgentKey, instruction: link.instruction }]
          : [];
      }),
      cleared: redact.cleared(),
    };
  });

  /** Reads and checks a transfer file. A new file replaces the one the same owner read before. */
  readonly stage = Effect.fn("InstanceTransfer.stage")(function* (
    this: InstanceTransferService,
    path: string,
    owner = LOCAL_OWNER,
  ): Effect.fn.Return<InstanceTransferPreview, ArchiveOperationError> {
    return yield* this.#stageFile(path, owner, false, ARCHIVE, false);
  }).bind(this);

  /** A file that a member of a joined client sends: the service keeps it until the token ends. */
  readonly stageUpload = Effect.fn("InstanceTransfer.stageUpload")(function* (
    this: InstanceTransferService,
    read: () => Promise<Uint8Array>,
    owner: string,
  ): Effect.fn.Return<InstanceTransferPreview, ArchiveOperationError> {
    const directory = this.options.uploadDirectory;
    if (!directory) return yield* archiveFailure(new Error("Instance transfer uploads are not available."));
    const bytes = yield* archiveCall(() => read());
    yield* this.#prepareUploadDirectory(directory);
    const path = join(directory, `${randomUUID()}.zip`);
    yield* archiveCall(() => writeFile(path, bytes, { flag: "wx", mode: 0o600 }));
    return yield* this.#stageFile(path, owner, true, REMOTE_ARCHIVE, true).pipe(
      Effect.tapError(() => archiveCall(() => rm(path, { force: true })).pipe(Effect.ignore)),
    );
  }).bind(this);

  /** A copy from another server stages bytes it already holds, without a file dialog. */
  readonly stageBytes = Effect.fn("InstanceTransfer.stageBytes")(function* (
    this: InstanceTransferService,
    bytes: Uint8Array,
  ): Effect.fn.Return<InstanceTransferPreview, ArchiveOperationError> {
    const directory = this.options.uploadDirectory;
    if (!directory) return yield* archiveFailure(new Error("Instance transfer uploads are not available."));
    yield* this.#prepareUploadDirectory(directory);
    const path = join(directory, `${randomUUID()}.zip`);
    yield* archiveCall(() => writeFile(path, bytes, { flag: "wx", mode: 0o600 }));
    // The bytes are already here, so this target reads its own 2 GB limit rather than the 100 MB
    // one a WebRTC transfer uses. The file still goes through the upload directory and expires.
    return yield* this.#stageFile(path, LOCAL_OWNER, true, ARCHIVE, true).pipe(
      Effect.tapError(() => archiveCall(() => rm(path, { force: true })).pipe(Effect.ignore)),
    );
  }).bind(this);

  /** Clear files from the previous process before either writer creates a file. */
  readonly #prepareUploadDirectory = Effect.fn("InstanceTransfer.prepareUploadDirectory")(function* (
    this: InstanceTransferService,
    directory: string,
  ) {
    if (this.#uploadDirectoryReady) return yield* Deferred.await(this.#uploadDirectoryReady);
    const ready = Deferred.makeUnsafe<void, ArchiveOperationError>();
    this.#uploadDirectoryReady = ready;
    const exit = yield* Effect.exit(
      Effect.gen(function* () {
        yield* archiveCall(() => rm(directory, { recursive: true, force: true }));
        yield* archiveCall(() => mkdir(directory, { recursive: true, mode: 0o700 }));
      }),
    );
    yield* Deferred.done(ready, exit);
    if (Exit.isFailure(exit)) this.#uploadDirectoryReady = null;
    return yield* exit;
  }, Effect.uninterruptible);

  readonly #stageFile = Effect.fn("InstanceTransfer.stageFile")(function* (
    this: InstanceTransferService,
    path: string,
    owner: string,
    temporary: boolean,
    limits: ArchiveLimits,
    migrate: boolean,
  ): Effect.fn.Return<InstanceTransferPreview, ArchiveOperationError> {
    // The file read before stays staged until this one is checked, so a bad file keeps it.
    const bytes = yield* readArchiveEffect(path, limits);
    const entries = yield* archiveSync(() => listEntries(bytes, limits));
    if (!entries.has(INSTANCE_TRANSFER_MANIFEST))
      return yield* archiveFailure(new Error(sourceText("error.import.transferNotFile")));
    const { manifest, warnings } = yield* archiveSync(() =>
      decodeTransferManifest(
        extract(bytes, (name) => name === INSTANCE_TRANSFER_MANIFEST)[INSTANCE_TRANSFER_MANIFEST] ?? new Uint8Array(),
      ),
    );
    // An agent whose skill has no SKILL.md cannot import, so it is not offered.
    const agents = manifest.agents.filter((agent) => {
      const missing = agent.skills.find((skill) => !entries.has(`${skill}/SKILL.md`));
      if (missing) warnings.push(sourceText("error.import.skillFolderMissing", { name: agent.name, skill: missing }));
      return !missing;
    });
    const avatarPaths = new Set(agents.flatMap((agent) => (agent.avatar ? [agent.avatar] : [])));
    const avatarBytes = yield* archiveSync(() => extract(bytes, (name) => avatarPaths.has(name)));
    const avatars = new Map<string, AvatarImageInput>();
    for (const agent of agents) {
      if (!agent.avatar) continue;
      const image = avatarImage(avatarBytes[agent.avatar]);
      if (image) avatars.set(agent.key, image);
      else warnings.push(sourceText("error.import.avatarSkipped", { name: agent.name }));
    }
    const existing = new Set(this.options.agents.listAgents().map((agent) => agent.name.toLowerCase()));
    const staged: StagedTransfer = {
      token: randomUUID(),
      owner,
      temporary,
      path,
      sha256: sha256(bytes),
      manifest: { ...manifest, agents },
      avatars,
      migrate,
    };
    yield* this.#release(owner);
    this.#staged.set(staged.token, staged);
    if (temporary) {
      // A member who leaves the import open does not keep the file on the host.
      setTimeout(() => {
        if (this.#staged.get(staged.token) === staged) void Effect.runPromise(this.#drop(staged));
      }, UPLOAD_TTL_MS).unref();
    }
    return {
      token: staged.token,
      appVersion: manifest.appVersion,
      exportedAt: manifest.exportedAt,
      agents: agents.map((agent): AgentImportPreviewAgent => {
        const files = agent.files ? [...entries].filter(([name]) => name.startsWith(`${agent.files}/`)) : [];
        const avatar = avatars.get(agent.key);
        return {
          key: agent.key,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          avatarUrl: avatar ? `data:${avatar.mimeType};base64,${Buffer.from(avatar.bytes).toString("base64")}` : null,
          skillCount: agent.skills.length,
          routineCount: transferRoutines(agent).length,
          memoryCount: agent.memories.length,
          fileCount: files.length,
          fileBytes: files.reduce((total, [, entry]) => total + entry.size, 0),
          nameExists: existing.has(agent.name.toLowerCase()),
        };
      }),
      hasSettings: manifest.settings !== null,
      warnings: bounded(warnings),
      migrationId: migrate ? migrationIdFor(agents.map((agent) => agent.key)) : null,
    };
  });

  readonly discard = Effect.fn("InstanceTransfer.discard")(function* (
    this: InstanceTransferService,
    token: string,
    owner = LOCAL_OWNER,
  ) {
    const staged = this.#staged.get(token);
    if (staged && staged.owner === owner) yield* this.#drop(staged);
  }).bind(this);

  readonly #release = Effect.fn("InstanceTransfer.release")(function* (this: InstanceTransferService, owner: string) {
    for (const staged of [...this.#staged.values()]) if (staged.owner === owner) yield* this.#drop(staged);
  });

  readonly #drop = Effect.fn("InstanceTransfer.drop")(function* (
    this: InstanceTransferService,
    staged: StagedTransfer,
  ) {
    this.#staged.delete(staged.token);
    if (staged.temporary) yield* archiveCall(() => rm(staged.path, { force: true })).pipe(Effect.ignore);
  });

  readonly #readMigration = Effect.fn("InstanceTransfer.readMigration")(function* (
    this: InstanceTransferService,
    owner: string,
    migrationId: string,
  ): Effect.fn.Return<MigrationRecord | null, ArchiveOperationError> {
    return yield* this.#ledger.withPermits(1)(
      archiveCall(() => readMigration(this.options.migrationLedgerPath, owner, migrationId)),
    );
  });

  readonly #saveMigration = Effect.fn("InstanceTransfer.saveMigration")(function* (
    this: InstanceTransferService,
    context: MigrationContext,
  ): Effect.fn.Return<void, ArchiveOperationError> {
    yield* this.#ledger.withPermits(1)(
      archiveCall(() => writeMigration(this.options.migrationLedgerPath, context.owner, context.id, context.record)),
    );
  });

  readonly #removeMigration = Effect.fn("InstanceTransfer.removeMigration")(function* (
    this: InstanceTransferService,
    owner: string,
    migrationId: string,
  ): Effect.fn.Return<void, ArchiveOperationError> {
    yield* this.#ledger.withPermits(1)(
      archiveCall(() => removeMigration(this.options.migrationLedgerPath, owner, migrationId)),
    );
  });

  /**
   * Deletes only the agents this migration created. Settings it added are kept, and an entry whose
   * agent cannot be deleted stays for a later rollback.
   */
  readonly rollback = Effect.fn("InstanceTransfer.rollback")(function* (
    this: InstanceTransferService,
    migrationId: string,
    owner = LOCAL_OWNER,
  ): Effect.fn.Return<{ agents: number }, ArchiveOperationError> {
    const record = yield* this.#readMigration(owner, migrationId).pipe(Effect.orElseSucceed(() => null));
    if (!record) return { agents: 0 };
    let removed = 0;
    const existing = new Set(this.options.agents.listAgents().map((agent) => agent.id));
    for (const [key, entry] of Object.entries(record.agents)) {
      if (existing.has(entry.agentId)) {
        const result = yield* Effect.result(this.options.agents.deleteAgent(entry.agentId));
        if (Result.isFailure(result)) continue;
        yield* this.options.settings.removeAgent(entry.agentId).pipe(Effect.ignore);
        removed += 1;
      }
      // The agent is gone with its routines and memories; the skill revisions it published remain.
      for (const skill of Object.values(entry.skills))
        yield* this.options.skills.library().withdraw(skill.id, skill.revision).pipe(Effect.ignore);
      delete record.agents[key];
    }
    if (Object.keys(record.agents).length === 0) yield* this.#removeMigration(owner, migrationId);
    else yield* this.#saveMigration({ owner, id: migrationId, record });
    return { agents: removed };
  }).bind(this);

  /** Holds the source bytes of a move until the target confirms, under the migration id. */
  readonly keepForMove = Effect.fn("InstanceTransfer.keepForMove")(function* (
    this: InstanceTransferService,
    migrationId: string,
    bytes: Uint8Array,
  ): Effect.fn.Return<void, ArchiveOperationError> {
    const directory = this.options.moveDirectory;
    if (!/^[\da-f]{64}$/u.test(migrationId))
      return yield* archiveFailure(new Error(sourceText("error.import.transferMoveInvalid")));
    yield* archiveCall(() => mkdir(directory, { recursive: true, mode: 0o700 }));
    yield* this.#cleanupMoves(directory, migrationId).pipe(Effect.ignore);
    const path = join(directory, `${migrationId}.zip`);
    const part = `${path}.part`;
    yield* archiveCall(() => writeFile(part, bytes, { mode: 0o600 }));
    yield* archiveCall(() => rename(part, path)).pipe(
      Effect.tapError(() => archiveCall(() => rm(part, { force: true })).pipe(Effect.ignore)),
    );
  }).bind(this);

  /** Removes move files left by a run that never confirmed. Best effort: a running move is kept. */
  readonly #cleanupMoves = Effect.fn("InstanceTransfer.cleanupMoves")(function* (
    this: InstanceTransferService,
    directory: string,
    current: string,
  ) {
    const listed = yield* Effect.result(archiveCall(() => readdir(directory)));
    if (Result.isFailure(listed)) return;
    const cutoff = this.#now().getTime() - 7 * 24 * 60 * 60_000;
    for (const name of listed.success) {
      if (!name.endsWith(".zip") || name === `${current}.zip`) continue;
      const path = join(directory, name);
      const info = yield* Effect.result(archiveCall(() => stat(path)));
      if (Result.isSuccess(info) && info.success.mtimeMs < cutoff)
        yield* archiveCall(() => rm(path, { force: true })).pipe(Effect.ignore);
    }
  });

  /**
   * Writes the source archive of a confirmed move to `~/OpenBot/Archives` and releases the held
   * bytes. The new file replaces an earlier archive of the same migration, so it always holds the
   * bytes the target just confirmed. A retry after the bytes were released keeps the archive that
   * is already there.
   */
  readonly archiveMove = Effect.fn("InstanceTransfer.archiveMove")(function* (
    this: InstanceTransferService,
    migrationId: string,
  ): Effect.fn.Return<{ fileName: string; directory: string }, ArchiveOperationError> {
    if (!/^[\da-f]{64}$/u.test(migrationId))
      return yield* archiveFailure(new Error(sourceText("error.import.transferMoveInvalid")));
    const source = join(this.options.moveDirectory, `${migrationId}.zip`);
    const directory = this.options.archiveDirectory;
    const fileName = `openbot-transfer-move-${migrationId}.zip`;
    const target = join(directory, fileName);
    yield* archiveCall(() => mkdir(directory, { recursive: true, mode: 0o700 }));
    if (Result.isSuccess(yield* Effect.result(archiveCall(() => stat(source))))) {
      const part = `${target}.part`;
      yield* archiveCall(() => copyFile(source, part));
      yield* archiveCall(() => rename(part, target)).pipe(
        Effect.tapError(() => archiveCall(() => rm(part, { force: true })).pipe(Effect.ignore)),
      );
      yield* archiveCall(() => rm(source, { force: true })).pipe(Effect.ignore);
    } else if (Result.isFailure(yield* Effect.result(archiveCall(() => stat(target))))) {
      // Neither the held bytes nor an archive from an earlier confirmed move exist.
      return yield* archiveFailure(new Error(sourceText("error.import.transferMoveInvalid")));
    }
    return { fileName, directory };
  }).bind(this);

  /** The path of this service's own archive, never another file the user names. */
  archivePath(fileName: string): string {
    if (!isInstanceArchiveFileName(fileName)) throw new Error(sourceText("error.import.transferArchiveInvalid"));
    return join(this.options.archiveDirectory, fileName);
  }

  /** Removes the moved agents from this computer, after the archive holds them. */
  readonly deleteSourceAgents = Effect.fn("InstanceTransfer.deleteSourceAgents")(function* (
    this: InstanceTransferService,
    agents: ReadonlyArray<{ id: string; name: string }>,
  ) {
    const existing = new Set(this.options.agents.listAgents().map((agent) => agent.id));
    const moved: string[] = [];
    const retained: Array<{ agentId: string; name: string; reason: string }> = [];
    for (const agent of agents) {
      if (!existing.has(agent.id)) {
        moved.push(agent.id);
        continue;
      }
      const result = yield* Effect.result(this.options.agents.deleteAgent(agent.id));
      if (Result.isFailure(result)) {
        retained.push({ agentId: agent.id, name: agent.name, reason: message(result.failure) });
        continue;
      }
      yield* this.options.settings.removeAgent(agent.id).pipe(Effect.ignore);
      moved.push(agent.id);
    }
    return { moved, retained };
  }).bind(this);

  readonly apply = Effect.fn("InstanceTransfer.apply")(function* (
    this: InstanceTransferService,
    input: ApplyInstanceTransferInput,
    owner = LOCAL_OWNER,
    /** The caller's zone, for routines with no valid zone. A zone that is not valid reads as the host's. */
    timezone?: string,
  ): Effect.fn.Return<InstanceTransferResult, ArchiveOperationError> {
    const staged = this.#staged.get(input.token);
    // Another member's token reads as a closed file, so the answer does not show that it exists.
    if (!staged || staged.owner !== owner)
      return yield* archiveFailure(new Error(sourceText("error.import.exportClosed")));
    this.#staged.delete(staged.token);
    const fallbackTimezone = timezone !== undefined && validTimezone(timezone) ? timezone : this.#timezone();
    return yield* this.#applyStaged(staged, input, fallbackTimezone, owner).pipe(Effect.ensuring(this.#drop(staged)));
  }).bind(this);

  readonly #applyStaged = Effect.fn("InstanceTransfer.applyStaged")(function* (
    this: InstanceTransferService,
    staged: StagedTransfer,
    input: ApplyInstanceTransferInput,
    fallbackTimezone: string,
    owner: string,
  ): Effect.fn.Return<InstanceTransferResult, ArchiveOperationError> {
    const selected = staged.manifest.agents.filter((agent) => input.keys.includes(agent.key));
    if (selected.length !== input.keys.length)
      return yield* archiveFailure(new Error(sourceText("error.import.agentNotInExport")));
    // The file is read again rather than held since `stage`, and only the same bytes are accepted.
    const bytes = yield* readArchiveEffect(staged.path, staged.temporary ? REMOTE_ARCHIVE : ARCHIVE);
    if (sha256(bytes) !== staged.sha256)
      return yield* archiveFailure(new Error(sourceText("error.import.exportChanged")));

    const warnings: string[] = [];
    const settings = input.includeSettings ? staged.manifest.settings : null;
    const migrationId = staged.migrate ? migrationIdFor(staged.manifest.agents.map((agent) => agent.key)) : null;
    const context: MigrationContext | null =
      migrationId === null
        ? null
        : {
            owner,
            id: migrationId,
            record: (yield* this.#readMigration(owner, migrationId).pipe(
              Effect.catch(() => {
                warnings.push(sourceText("error.import.transferLedgerUnreadable"));
                return Effect.succeed(null);
              }),
            )) ?? { agents: {}, updatedAt: new Date(0).toISOString() },
          };
    const existing = new Map(this.options.agents.listAgents().map((agent) => [agent.id, agent]));
    // An agent this migration already created is not a new one, so a resumed run does not overflow
    // the limit. An agent the user deleted counts again.
    const creators = selected.filter((agent) => {
      const record = context?.record.agents[agent.key];
      return !(record && existing.has(record.agentId));
    });
    if (existing.size + creators.length > INPUT_LIMITS.agents)
      return yield* archiveFailure(
        new Error(sourceText("error.import.serverAgentLimit", { limit: INPUT_LIMITS.agents })),
      );
    let resumed = false;
    // Providers and custom agents first, so their warnings come first. Their models are not listed yet:
    // a save does not wait for model discovery, and an imported provider has no key. An agent on one
    // of them starts on the default model, and the warning asks the user to choose the model again.
    if (settings) yield* this.#applyProviders(settings, warnings);

    const imported: AgentSummary[] = [];
    const skipped: AgentImportSkipped[] = [];
    const agentIds = new Map<string, string>();
    const routineIds = new Map<string, string>();
    for (const agent of selected) {
      const record = context?.record.agents[agent.key];
      const current = record ? existing.get(record.agentId) : undefined;
      if (record && current) {
        resumed = true;
        // A finished agent is kept as it is; a partial one continues from its ledger entry.
        for (const [key, routineId] of Object.entries(record.routines)) routineIds.set(key, routineId);
      } else if (record) {
        // The user deleted it after an earlier run, so this run creates it again.
        delete context?.record.agents[agent.key];
      }
      const result = yield* Effect.result(
        this.#importAgent(bytes, staged, agent, routineIds, warnings, fallbackTimezone, context, current),
      );
      if (Result.isFailure(result)) {
        skipped.push({ key: agent.key, name: agent.name, reason: message(result.failure.cause) });
      } else {
        imported.push(result.success);
        agentIds.set(agent.key, result.success.id);
        existing.set(result.success.id, result.success);
      }
    }
    if (settings) yield* this.#applyLayout(settings, agentIds, routineIds, warnings);
    if (staged.manifest.shared) yield* this.#importShared(bytes, staged.manifest.shared, warnings);

    const signedIn = new Set(this.options.settings.signedInProviders());
    return {
      agents: imported,
      skipped,
      signIn: staged.manifest.signedIn.filter((provider) => !signedIn.has(provider)),
      warnings: bounded(warnings),
      migration: context ? { id: context.id, resumed } : null,
    };
  });

  readonly #applyProviders = Effect.fn("InstanceTransfer.applyProviders")(function* (
    this: InstanceTransferService,
    settings: TransferSettings,
    warnings: string[],
  ) {
    const port = this.options.settings;
    const cleared = new Set(settings.cleared ?? []);
    /** `skipped` writes the warning for a step that fails, from its reason. */
    const attempt = function* (skipped: (reason: string) => string, effect: Effect.Effect<unknown, unknown>) {
      const result = yield* Effect.result(effect);
      if (Result.isFailure(result)) warnings.push(skipped(message(causeOf(result.failure))));
      return Result.isSuccess(result);
    };

    const providers = new Set(port.customProviders().map((provider) => provider.id));
    for (const provider of settings.customProviders) {
      if (providers.has(provider.id)) continue;
      const saved = yield* attempt(
        named(provider.name),
        port.saveCustomProvider({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: null,
          models: [...provider.models],
          headers: [],
        }),
      );
      if (saved && provider.needsApiKey)
        warnings.push(sourceText("error.import.transferProviderKey", { name: provider.name }));
      if (saved && cleared.has(provider.name))
        warnings.push(sourceText("error.import.transferValuesCleared", { name: provider.name }));
    }

    // Saving a custom agent starts its command to list its models, so the import never saves one.
    // The warning names the command, and the user adds the agent again after checking it.
    const customAgents = new Set((yield* Effect.orElseSucceed(port.customAgents(), () => [])).map((agent) => agent.id));
    for (const agent of settings.customAgents) {
      if (customAgents.has(agent.id)) continue;
      const command = [agent.command, ...agent.args].join(" ");
      warnings.push(sourceText("error.import.transferCustomAgentCommand", { name: agent.name, command }));
      if (agent.envNames.length > 0)
        warnings.push(
          sourceText("error.import.transferAgentEnv", { name: agent.name, names: agent.envNames.join(", ") }),
        );
    }

    const servers = new Set(port.mcpServers().map((server) => server.name.toLowerCase()));
    for (const server of settings.mcpServers) {
      if (servers.has(server.name.toLowerCase())) continue;
      // A file can name any command, so an imported server stays off until the user checks it.
      const saved = yield* attempt(named(server.name), port.saveMcpServer({ ...server, id: "", enabled: false }));
      if (saved) warnings.push(sourceText("error.import.transferMcpValues", { name: server.name }));
    }
  });

  readonly #applyLayout = Effect.fn("InstanceTransfer.applyLayout")(function* (
    this: InstanceTransferService,
    settings: TransferSettings,
    agentIds: ReadonlyMap<string, string>,
    routineIds: ReadonlyMap<string, string>,
    warnings: string[],
  ) {
    const port = this.options.settings;
    let layout = port.sidebar();
    for (const section of settings.sidebarSections) {
      const members = section.agentKeys.flatMap((key) => {
        const id = agentIds.get(key);
        return id ? [id] : [];
      });
      if (members.length === 0) continue;
      let target = layout.sections.find((candidate) => candidate.name.toLowerCase() === section.name.toLowerCase());
      if (!target) {
        const before = new Set(layout.sections.map((candidate) => candidate.id));
        const created = yield* Effect.result(port.mutateSidebar({ type: "create", name: section.name }));
        if (Result.isFailure(created)) {
          warnings.push(
            sourceText("error.import.transferSettingSkipped", {
              name: section.name,
              reason: message(causeOf(created.failure)),
            }),
          );
          continue;
        }
        layout = created.success;
        target = layout.sections.find((candidate) => !before.has(candidate.id));
      }
      if (!target) continue;
      for (const agentId of members) {
        const assigned = yield* Effect.result(port.mutateSidebar({ type: "assign", agentId, sectionId: target.id }));
        if (Result.isSuccess(assigned)) layout = assigned.success;
      }
    }

    for (const link of settings.routineFlows) {
      const routineId = routineIds.get(link.routineKey);
      const fromAgentId = agentIds.get(link.fromAgentKey);
      const toAgentId = agentIds.get(link.toAgentKey);
      if (!routineId || !fromAgentId || !toAgentId) continue;
      const connected = yield* Effect.result(
        port.connectRoutineFlow({ routineId, fromAgentId, toAgentId, instruction: link.instruction }),
      );
      if (Result.isFailure(connected))
        warnings.push(
          sourceText("error.import.transferRoutineFlowSkipped", { reason: message(causeOf(connected.failure)) }),
        );
    }
  });

  /** Copies `~/OpenBot/Shared` files. A file that is already here is kept as it is. */
  readonly #importShared = Effect.fn("InstanceTransfer.importShared")(function* (
    this: InstanceTransferService,
    bytes: Uint8Array,
    folder: string,
    warnings: string[],
  ) {
    const files = yield* archiveSync(() => extract(bytes, (name) => name.startsWith(`${folder}/`)));
    const executable = yield* archiveSync(() => executableEntries(bytes));
    const base = resolve(this.options.sharedRoot);
    let kept = 0;
    for (const [name, data] of Object.entries(files)) {
      const inner = name.slice(folder.length + 1);
      const target = resolve(base, inner);
      if (isUnsafeEntry(inner) || isSharedData(inner) || !isPathInside(base, target)) continue;
      const written = yield* Effect.result(
        Effect.gen(function* () {
          yield* archiveCall(() => mkdir(dirname(target), { recursive: true }));
          yield* archiveCall(() => writeFile(target, data, { flag: "wx", mode: executable.has(name) ? 0o777 : 0o666 }));
        }),
      );
      if (Result.isFailure(written)) kept += 1;
    }
    if (kept > 0) warnings.push(sourceText("error.import.transferSharedKept", { number: kept }));
  });

  readonly #importAgent = Effect.fn("InstanceTransfer.importAgent")(function* (
    this: InstanceTransferService,
    bytes: Uint8Array,
    staged: StagedTransfer,
    source: TransferAgent,
    routineIds: Map<string, string>,
    warnings: string[],
    fallbackTimezone: string,
    context: MigrationContext | null,
    existingAgent: AgentSummary | undefined,
  ): Effect.fn.Return<AgentSummary, ArchiveOperationError> {
    const prefix = agentPrefix(source.key);
    const files = yield* archiveSync(() => extract(bytes, (name) => name.startsWith(prefix)));
    const read = (path: string) =>
      Object.entries(files)
        .filter(([name]) => name.startsWith(`${path}/`))
        .map(([name, data]) => [name.slice(path.length + 1), data] as const);
    // Every skill is checked before the agent exists, so a bad one publishes nothing.
    const skills = yield* archiveSync(() =>
      source.skills.map((folder) => {
        const skillFiles = read(folder);
        return { folder, files: skillFiles, slug: inspectArchive(zipSync(Object.fromEntries(skillFiles))).slug };
      }),
    );
    // The model is kept when this computer offers it, and the provider is on.
    const model = this.options.agents
      .listModels()
      .find((option) => option.provider === source.provider && option.id === source.model);
    const useModel = model !== undefined && !this.options.settings.providersOff().includes(source.provider);
    if (!useModel)
      warnings.push(sourceText("error.import.transferModelMissing", { name: source.name, model: source.model }));

    // A finished agent from an earlier run of this migration is kept as it is.
    const recorded = existingAgent ? context?.record.agents[source.key] : undefined;
    if (existingAgent && recorded?.done) return existingAgent;

    const published: Array<{ id: string; revision: number }> = [];
    let entry = recorded;
    let createdHere = false;
    let completed = false;
    const save = () => (context ? this.#saveMigration(context).pipe(Effect.mapError(failure)) : Effect.void);
    return yield* Effect.acquireUseRelease(
      existingAgent
        ? Effect.succeed(existingAgent)
        : this.options.agents
            .createAgentProfile({
              name: source.name,
              ...(source.title ? { title: source.title } : {}),
              description: source.description,
              avatarSeed: AVATAR_SEED_PATTERN.test(source.avatarSeed)
                ? source.avatarSeed
                : `${source.key}-${randomUUID()}`,
              avatarHue: source.avatarHue,
              ...(useModel
                ? { provider: source.provider, model: source.model, reasoningEffort: source.reasoningEffort }
                : {}),
            })
            .pipe(Effect.mapError(failure)),
      (created) =>
        Effect.gen({ self: this }, function* () {
          let agent = created;
          if (!existingAgent) {
            createdHere = true;
            if (context) {
              entry = { agentId: created.id, files: false, done: false, skills: {}, routines: {}, memories: {} };
              context.record.agents[source.key] = entry;
              // A ledger that cannot record the agent removes it again, so a retry does not duplicate.
              yield* save();
            }
          } else if (context && !entry) {
            entry = { agentId: created.id, files: false, done: false, skills: {}, routines: {}, memories: {} };
            context.record.agents[source.key] = entry;
            yield* save();
          }

          if (source.files && !entry?.files) {
            const folder = source.files;
            const executable = yield* archiveSync(() => executableEntries(bytes));
            yield* writeImportedFilesEffect(
              agent.workspacePath,
              read(folder).filter(([name]) => !isWorkspaceSkipped(name)),
              source.name,
              warnings,
              (name) => executable.has(`${folder}/${name}`),
            );
            if (entry) {
              entry.files = true;
              yield* save();
            }
          }
          const library = this.options.skills.library();
          for (const skill of skills) {
            const stored = entry?.skills[skill.folder];
            if (
              stored &&
              (yield* library.list().pipe(Effect.mapError(failure))).some(
                (candidate) => candidate.id === stored.id && candidate.version >= stored.revision,
              )
            )
              continue;
            const current = (yield* library.list().pipe(Effect.mapError(failure))).find(
              (candidate) => candidate.slug === skill.slug,
            );
            const folder = `${SKILL_STAGING}/${skill.slug}`;
            const target = join(agent.workspacePath, ...folder.split("/"));
            yield* Effect.acquireUseRelease(
              Effect.succeed(target),
              () =>
                Effect.gen({ self: this }, function* () {
                  yield* writeTreeEffect(target, skill.files);
                  const revision = yield* (
                    current
                      ? library.revise(agent.id, current.id, current.version, folder)
                      : library.create(agent.id, folder)
                  ).pipe(Effect.mapError(failure), Effect.uninterruptible);
                  published.push({ id: revision.id, revision: revision.version });
                  yield* this.options.skills
                    .installLocal({ agentId: agent.id, skillId: revision.id, revision: revision.version })
                    .pipe(Effect.mapError(failure), Effect.uninterruptible);
                  if (entry) {
                    entry.skills[skill.folder] = { id: revision.id, revision: revision.version };
                    yield* save();
                  }
                }),
              () => archiveCall(() => rm(target, { recursive: true, force: true })),
            );
          }

          const routines = this.options.agents.listRoutines(agent.id);
          for (const routine of transferRoutines(source)) {
            const stored = entry?.routines[routine.key];
            if (stored && routines.some((candidate) => candidate.id === stored)) {
              routineIds.set(routine.key, stored);
              continue;
            }
            const created = yield* archiveSync(() =>
              this.options.agents.createRoutine(
                {
                  agentId: agent.id,
                  name: routine.name,
                  instruction: routine.instruction,
                  active: routine.active,
                  timezone: validTimezone(routine.timezone) ? routine.timezone : fallbackTimezone,
                  schedule: routine.schedule,
                  ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
                  ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
                },
                { recordConversationEvent: false },
              ),
            ).pipe(Effect.result);
            if (Result.isSuccess(created)) {
              routineIds.set(routine.key, created.success.id);
              if (entry) {
                entry.routines[routine.key] = created.success.id;
                yield* save();
              }
            } else
              warnings.push(
                sourceText("error.import.routineSkipped", {
                  name: source.name,
                  routine: routine.name,
                  reason: message(created.failure.cause),
                }),
              );
          }

          // The limit can be lower here than on the computer that made the file.
          const memoryLimit = this.options.agents.memoryLimit();
          if (source.memories.length > memoryLimit)
            warnings.push(sourceText("error.import.memoryLimit", { name: source.name, limit: memoryLimit }));
          const memories = new Set(this.options.agents.listMemories(agent.id).map((memory) => memory.id));
          const chosen: Array<{
            memoryId: string;
            inclusion: NonNullable<TransferAgent["memories"][number]["inclusion"]>;
          }> = [];
          for (const [index, memory] of source.memories.slice(0, memoryLimit).entries()) {
            const stored = entry?.memories[String(index)];
            let memoryId = stored && memories.has(stored) ? stored : undefined;
            if (!memoryId) {
              memoryId = this.options.agents.createMemory({ agentId: agent.id, text: memory.text }).id;
              if (entry) {
                entry.memories[String(index)] = memoryId;
                yield* save();
              }
            }
            if (memory.inclusion) chosen.push({ memoryId, inclusion: memory.inclusion });
          }
          yield* archiveSync(() => this.options.agents.initializeMemorySelection(agent.id));
          if (chosen.length > 0) {
            const revisions = new Map(
              this.options.agents
                .getMemorySelection(agent.id)
                .selections.map((selection) => [selection.memoryId, selection.revision]),
            );
            yield* archiveSync(() =>
              this.options.agents.setMemoryInclusion({
                agentId: agent.id,
                changes: chosen.map((change) => ({ ...change, expectedRevision: revisions.get(change.memoryId) ?? 0 })),
              }),
            ).pipe(Effect.ignore);
          }

          const avatar = staged.avatars.get(source.key);
          if (avatar) agent = yield* this.options.agents.setAvatar(agent.id, avatar).pipe(Effect.mapError(failure));
          agent = yield* this.options.agents
            .updateAgent({
              agentId: agent.id,
              notifications: source.notifications,
              ...(source.busyMessageMode ? { busyMessageMode: source.busyMessageMode } : {}),
              ...(source.taskLimit === undefined ? {} : { taskLimit: source.taskLimit }),
            })
            .pipe(Effect.mapError(failure));
          if (entry) {
            entry.done = true;
            yield* save();
          }
          completed = true;
          return agent;
        }),
      (agent) =>
        completed
          ? Effect.void
          : Effect.gen({ self: this }, function* () {
              // A resumed agent stays for the next retry; one created here is removed with its entry.
              if (createdHere) {
                yield* this.options.agents.deleteAgent(agent.id).pipe(Effect.ignore);
                if (context) {
                  delete context.record.agents[source.key];
                  yield* this.#saveMigration(context).pipe(Effect.ignore);
                }
              }
              for (const skill of published.reverse())
                yield* this.options.skills.library().withdraw(skill.id, skill.revision).pipe(Effect.ignore);
            }).pipe(Effect.orDie),
    );
  });
}

/**
 * The files an export carries from one folder: no link, nothing `isUnsafeArchivePath` refuses on
 * import (`.git`, `node_modules`, `.env*`, private keys, nested archives), and not OpenBot's own
 * workspace folders.
 */
const workspaceFiles = Effect.fn("InstanceTransfer.workspaceFiles")(function* (
  root: string,
): Effect.fn.Return<FileEntry[], ArchiveOperationError> {
  return yield* walk(root, isWorkspaceSkipped);
});

/** OpenBot's own workspace folders: an export leaves them out, and an import never writes them. */
function isWorkspaceSkipped(name: string): boolean {
  // A disk that ignores case writes `.OpenBot/` into `.openbot/`, so the check ignores case too.
  const lower = name.toLowerCase();
  return WORKSPACE_SKIPPED.some((skipped) => lower === skipped || lower.startsWith(`${skipped}/`));
}

const walk = Effect.fn("InstanceTransfer.walk")(function* (
  root: string,
  skip: (name: string) => boolean = () => false,
): Effect.fn.Return<FileEntry[], ArchiveOperationError> {
  const files: FileEntry[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop() ?? root;
    const listed = yield* Effect.result(archiveCall(() => readdir(directory, { withFileTypes: true })));
    // A missing folder has no files: a new agent may not have a workspace yet. A folder that cannot
    // be read stops the export, as a file that cannot be read does, so no file is left out silently.
    if (Result.isFailure(listed)) {
      if (isMissingFileError(listed.failure.cause)) continue;
      return yield* listed.failure;
    }
    for (const entry of listed.success) {
      const path = join(directory, entry.name);
      const name = relative(root, path).split(sep).join("/");
      if (skip(name) || isUnsafeArchivePath(name)) continue;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        // A running agent can delete a file between `readdir` and `lstat`; that file is not exported.
        const info = yield* Effect.result(archiveCall(() => lstat(path)));
        if (Result.isSuccess(info))
          files.push({ name, path, size: info.success.size, executable: (info.success.mode & 0o111) !== 0 });
        else if (!isMissingFileError(info.failure.cause)) return yield* info.failure;
      }
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
});

/** The skills a user or a marketplace installed. OpenBot's own skills are installed again on import. */
const skillFolders = Effect.fn("InstanceTransfer.skillFolders")(function* (
  workspace: string,
): Effect.fn.Return<Array<{ slug: string; files: FileEntry[] }>, ArchiveOperationError> {
  const skills = new Map<string, FileEntry[]>();
  for (const folder of MANAGED_SKILL_FOLDERS) {
    const root = join(workspace, ...folder.split("/"));
    const listed = yield* Effect.result(archiveCall(() => readdir(root)));
    if (Result.isFailure(listed)) {
      if (isMissingFileError(listed.failure.cause)) continue;
      return yield* listed.failure;
    }
    for (const slug of listed.success) {
      if (skills.has(slug) || isUnsafeArchivePath(slug)) continue;
      const directory = join(root, slug);
      // `stat` follows a link: `npx skills` links each skill folder to one shared copy.
      const info = yield* Effect.result(archiveCall(() => stat(directory)));
      // A link to a skill that is gone is not a skill.
      if (Result.isFailure(info) && !isMissingFileError(info.failure.cause)) return yield* info.failure;
      if (Result.isFailure(info) || !info.success.isDirectory()) continue;
      const files = yield* walk(directory);
      if (files.some((file) => file.name === OWNERSHIP_MARKER) || !files.some((file) => file.name === "SKILL.md"))
        continue;
      skills.set(slug, files);
    }
  }
  return [...skills].sort(([a], [b]) => a.localeCompare(b)).map(([slug, files]) => ({ slug, files }));
});

/** A flag, a `KEY=value` argument or a header line whose name says it holds a secret. */
const SECRET_NAME = /token|secret|password|passwd|api[-_]?key|apikey|auth|credential|private[-_]?key|access[-_]?key/iu;

/**
 * Removes values that can hold a secret from MCP and custom agent arguments and from URLs, and
 * records whose values it removed, so the import can ask for them again.
 */
export function createRedaction() {
  const names = new Set<string>();
  const url = (owner: string, value: string): string => {
    if (!value) return value;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return value;
    }
    if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) return value;
    names.add(owner);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  };
  return {
    args(owner: string, args: readonly string[]): string[] {
      return args.map((arg, index) => {
        const separator = /[=:]/u.exec(arg);
        if (separator && separator.index > 0 && SECRET_NAME.test(arg.slice(0, separator.index))) {
          names.add(owner);
          return arg.slice(0, separator.index + 1);
        }
        const flag = args[index - 1];
        if (!arg.startsWith("-") && flag?.startsWith("-") && !/[=:]/u.test(flag) && SECRET_NAME.test(flag)) {
          names.add(owner);
          return "";
        }
        // A connection string keeps its password in the URL, as a positional value or after `=`.
        const equals = arg.indexOf("=");
        if (equals > 0) return arg.slice(0, equals + 1) + url(owner, arg.slice(equals + 1));
        return url(owner, arg);
      });
    },
    url,
    /** Only the origin of an MCP address: some services keep the access key in the path. */
    origin(owner: string, value: string): string {
      if (!value) return value;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return value;
      }
      if (`${parsed.origin}/` === parsed.href || parsed.origin === parsed.href) return value;
      names.add(owner);
      return parsed.origin;
    },
    cleared: () => [...names],
  };
}

/** The warning for an item of the settings that is not imported. */
function named(name: string): (reason: string) => string {
  return (reason) => sourceText("error.import.transferSettingSkipped", { name, reason });
}

/** The routines of an agent in a file, with the one-time routines that older apps skip. */
function transferRoutines(agent: TransferAgent): TransferAgent["routines"] {
  return [...agent.routines, ...(agent.oneTimeRoutines ?? [])];
}

function isSharedData(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === SHARED_DATA || lower.startsWith(`${SHARED_DATA}/`);
}

interface ZipEntry {
  name: string;
  read: () => Promise<Uint8Array>;
  executable?: boolean;
}

/** Writes the archive to `<path>.part` one file at a time, then renames it. */
const writeZipEffect = Effect.fn("InstanceTransfer.writeZip")(function* (
  path: string,
  entries: ReadonlyArray<ZipEntry>,
): Effect.fn.Return<number, ArchiveOperationError> {
  const part = `${path}.part`;
  return yield* archiveCall(async () => {
    let gone = 0;
    const handle = await open(part, "w");
    try {
      let pending = Promise.resolve();
      let error: unknown = null;
      const zip = new Zip((failure, chunk) => {
        if (failure) error = failure;
        else pending = pending.then(() => handle.write(chunk).then(() => undefined));
      });
      for (const entry of entries) {
        let data: Uint8Array;
        try {
          data = await entry.read();
        } catch (cause) {
          // A running agent can delete a file after the walk; the export goes on without it.
          if (!isMissingFileError(cause)) throw cause;
          gone += 1;
          continue;
        }
        // Stored, not compressed: compression would run on the main thread.
        const file = new ZipPassThrough(entry.name);
        if (entry.executable !== undefined) {
          // A Unix mode, as Git keeps it: only if the file is executable. The import restores the bits.
          file.os = 3;
          file.attrs = (entry.executable ? 0o100755 : 0o100644) * 0x10000;
        }
        zip.add(file);
        file.push(data, true);
        await pending;
        if (error) throw error;
      }
      zip.end();
      await pending;
      if (error) throw error;
    } finally {
      await handle.close();
    }
    await rename(part, path);
    return gone;
  }).pipe(Effect.tapError(() => archiveCall(() => rm(part, { force: true })).pipe(Effect.ignore)));
});

function failure(error: unknown): ArchiveOperationError {
  return archiveFailure(causeOf(error));
}

/** A service error keeps the original error as its cause. */
function causeOf(error: unknown): Error {
  if (error instanceof Error && error.cause instanceof Error) return error.cause;
  return error instanceof Error ? error : new Error("The import failed.");
}

function bounded(warnings: string[]): string[] {
  return warnings.slice(0, AGENT_IMPORT_LIMITS.warnings).map((text) => text.slice(0, AGENT_IMPORT_LIMITS.message));
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : "The import failed.";
  return text.slice(0, AGENT_IMPORT_LIMITS.message);
}
