import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMemory, AgentSummary, ConversationMessage, Routine } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { CONVERSATIONS_FILE, type ConversationSource, importedThreadId } from "./instance-transfer-conversations";
import { migrationIdFor, writeMigration } from "./instance-transfer-ledger";
import {
  INSTANCE_TRANSFER_FORMAT,
  INSTANCE_TRANSFER_MANIFEST,
  INSTANCE_TRANSFER_VERSION,
} from "./instance-transfer-manifest";
import { type InstanceTransferOptions, InstanceTransferService } from "./instance-transfer-service";
import { LocalSkillFailure } from "./local-skill-library";

const AGENT = {
  key: "alpha",
  name: "Alpha",
  title: "First agent",
  description: "",
  avatarSeed: "alpha",
  avatarHue: null,
  avatar: null,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  notifications: true,
  skills: [],
  files: null,
  routines: [
    {
      key: "daily",
      name: "Daily",
      instruction: "Do the daily work.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    },
  ],
  memories: [{ text: "Prefers short answers." }],
} as const;

const BETA = { ...AGENT, key: "beta", name: "Beta" } as const;

const MIGRATION_ALPHA = migrationIdFor([AGENT.key]);
const MIGRATION_BETA = migrationIdFor([BETA.key]);

/** A transfer file with one agent that has no files and no skills, so a test stays in memory. */
function archive(agents: readonly unknown[] = [AGENT]): Uint8Array {
  const manifest = {
    format: INSTANCE_TRANSFER_FORMAT,
    version: INSTANCE_TRANSFER_VERSION,
    source: { appVersion: "test", exportedAt: "2026-10-27T00:00:00.000Z" },
    agents,
    settings: null,
    shared: null,
    signedIn: [],
  };
  return zipSync({ [INSTANCE_TRANSFER_MANIFEST]: strToU8(JSON.stringify(manifest)) });
}

interface Store {
  agents: Map<string, AgentSummary>;
  routines: Map<string, Routine[]>;
  memories: Map<string, AgentMemory[]>;
  /** The conversations each agent keeps, as the database lists them. */
  threads: Map<string, ConversationSource[]>;
  /** What an import wrote, by agent and thread id. A write of an id that exists replaces it. */
  imported: Map<string, Map<string, { title: string; createdAt: string; messages: ConversationMessage[] }>>;
  /** Agents whose deletion fails, to check the retained list and a rollback that can retry. */
  failing: Set<string>;
  removedFromSidebar: string[];
  nextId: number;
}

function store(): Store {
  return {
    agents: new Map(),
    routines: new Map(),
    memories: new Map(),
    threads: new Map(),
    imported: new Map(),
    failing: new Set(),
    removedFromSidebar: [],
    nextId: 1,
  };
}

function agentSummary(id: string, name: string, root: string): AgentSummary {
  return {
    id,
    name,
    title: "",
    description: "",
    notifications: true,
    provider: "codex",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: join(root, "workspaces", id),
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

/** Adds an agent the migration did not create, so a rollback must leave it alone. */
function seedAgent(store: Store, root: string, name: string): AgentSummary {
  const id = `seed-${store.nextId++}`;
  const agent = agentSummary(id, name, root);
  store.agents.set(id, agent);
  store.routines.set(id, []);
  store.memories.set(id, []);
  return agent;
}

function service(root: string, state: Store): InstanceTransferService {
  const agents: InstanceTransferOptions["agents"] = {
    listAgents: () => [...state.agents.values()],
    listModels: () => [{ provider: "codex", id: "gpt-5.5" }],
    createAgentProfile: (input) =>
      Effect.sync(() => {
        const id = `agent-${state.nextId++}`;
        const agent: AgentSummary = {
          ...agentSummary(id, input.name, root),
          title: input.title ?? "",
          description: input.description,
          provider: input.provider ?? "codex",
          model: input.model ?? "gpt-5.5",
          reasoningEffort: input.reasoningEffort ?? "medium",
          avatarSeed: input.avatarSeed,
          avatarHue: input.avatarHue,
        };
        state.agents.set(id, agent);
        state.routines.set(id, []);
        state.memories.set(id, []);
        return agent;
      }),
    updateAgent: (input) =>
      Effect.sync(() => {
        const agent = state.agents.get(input.agentId);
        if (!agent) throw new Error("The agent is gone.");
        const updated = { ...agent, notifications: input.notifications ?? agent.notifications };
        state.agents.set(updated.id, updated);
        return updated;
      }),
    listRoutines: (agentId) => state.routines.get(agentId) ?? [],
    listConversationThreads: (agentId) =>
      (state.threads.get(agentId) ?? []).map(({ threadId, title, createdAt, updatedAt }) => ({
        threadId,
        title,
        createdAt,
        updatedAt,
      })),
    readConversationThread: (agentId, threadId) => ({
      agentId,
      threadId,
      activeTurnId: null,
      revision: 1,
      messages: (state.threads.get(agentId) ?? []).find((thread) => thread.threadId === threadId)?.messages ?? [],
    }),
    importConversationThread: ({ agentId, threadId, title, createdAt, messages }) => {
      const byThread = state.imported.get(agentId) ?? new Map();
      byThread.set(threadId, { title, createdAt, messages });
      state.imported.set(agentId, byThread);
    },
    createRoutine: (input) => {
      const id = `routine-${state.nextId++}`;
      const list = state.routines.get(input.agentId) ?? [];
      list.push({
        id,
        agentId: input.agentId,
        name: input.name,
        instruction: input.instruction,
        active: input.active,
        timezone: input.timezone,
        trigger: {
          id: `trigger-${state.nextId++}`,
          routineId: id,
          schedule: input.schedule,
          nextRunAt: "2026-10-27T01:00:00.000Z",
          createdAt: "2026-10-27T00:00:00.000Z",
          updatedAt: "2026-10-27T00:00:00.000Z",
        },
        createdAt: "2026-10-27T00:00:00.000Z",
        updatedAt: "2026-10-27T00:00:00.000Z",
      });
      state.routines.set(input.agentId, list);
      return { id };
    },
    listMemories: (agentId) => state.memories.get(agentId) ?? [],
    getMemorySelection: () => ({ selections: [] }),
    setMemoryInclusion: () => undefined,
    initializeMemorySelection: () => undefined,
    memoryLimit: () => 100,
    createMemory: (input) => {
      const id = `memory-${state.nextId++}`;
      const list = state.memories.get(input.agentId) ?? [];
      list.push({
        id,
        agentId: input.agentId,
        text: input.text,
        origin: "manual",
        sourceTurnId: null,
        createdAt: "2026-10-27T00:00:00.000Z",
        updatedAt: "2026-10-27T00:00:00.000Z",
      });
      state.memories.set(input.agentId, list);
      return { id };
    },
    resolveAvatar: () => null,
    setAvatar: (agentId) => {
      const agent = state.agents.get(agentId);
      if (!agent) return Effect.fail(new Error("The agent is gone."));
      return Effect.succeed(agent);
    },
    deleteAgent: (agentId) =>
      state.failing.has(agentId)
        ? Effect.fail(new Error("The agent is busy."))
        : Effect.sync(() => {
            state.agents.delete(agentId);
            state.routines.delete(agentId);
            state.memories.delete(agentId);
          }),
  };
  const library: ReturnType<InstanceTransferOptions["skills"]["library"]> = {
    list: () => Effect.succeed([]),
    create: () => Effect.fail(new LocalSkillFailure({ cause: new Error("A test archive has no skills.") })),
    revise: () => Effect.fail(new LocalSkillFailure({ cause: new Error("A test archive has no skills.") })),
    withdraw: () => Effect.void,
  };
  const settings: InstanceTransferOptions["settings"] = {
    mcpServers: () => [],
    saveMcpServer: () => Effect.void,
    customProviders: () => [],
    saveCustomProvider: () => Effect.void,
    customAgents: () => Effect.succeed([]),
    providersOff: () => [],
    sidebar: () => ({
      revision: 0,
      sections: [],
      order: ["people", "unassigned"],
      agentAssignments: {},
      agentOrder: [],
    }),
    mutateSidebar: () => Effect.fail(new Error("A test archive has no layout.")),
    routineFlowLinks: () => Effect.succeed([]),
    connectRoutineFlow: () => Effect.void,
    removeAgent: (agentId) =>
      Effect.sync(() => {
        state.removedFromSidebar.push(agentId);
      }),
    signedInProviders: () => [],
  };
  return new InstanceTransferService({
    uploadDirectory: join(root, "instance-transfer-uploads"),
    migrationLedgerPath: join(root, "instance-transfer-migrations.json"),
    moveDirectory: join(root, "instance-transfer-moves"),
    archiveDirectory: join(root, "Archives"),
    sharedRoot: join(root, "shared"),
    appVersion: "test",
    agents,
    skills: { library: () => library, installLocal: () => Effect.void },
    settings,
    timezone: () => "UTC",
  });
}

const roots: string[] = [];

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-transfer-service-"));
  roots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("instance transfer migration", () => {
  it("records a migration and resumes it from the ledger after a restart", async () => {
    const directory = await root();
    const state = store();
    const first = service(directory, state);

    const preview = await Effect.runPromise(first.stageBytes(archive()));
    expect(preview.migrationId).toBe(MIGRATION_ALPHA);
    const applied = await Effect.runPromise(
      first.apply({ token: preview.token, keys: [AGENT.key], includeSettings: false }),
    );
    expect(applied.migration).toEqual({ id: MIGRATION_ALPHA, resumed: false });
    expect(applied.agents).toHaveLength(1);
    expect(state.agents.size).toBe(1);
    expect([...state.routines.values()][0]).toHaveLength(1);
    expect([...state.memories.values()][0]).toHaveLength(1);
    const agentId = applied.agents[0]?.id;

    // A new service instance reads the same ledger, as the next app launch does.
    const second = service(directory, state);
    const again = await Effect.runPromise(second.stageBytes(archive()));
    const resumed = await Effect.runPromise(
      second.apply({ token: again.token, keys: [AGENT.key], includeSettings: false }),
    );

    expect(resumed.migration).toEqual({ id: MIGRATION_ALPHA, resumed: true });
    expect(resumed.agents.map((agent) => agent.id)).toEqual([agentId]);
    expect(state.agents.size).toBe(1);
    expect([...state.routines.values()][0]).toHaveLength(1);
    expect([...state.memories.values()][0]).toHaveLength(1);
  });

  it("continues an agent that an interrupted apply left half done", async () => {
    const directory = await root();
    const state = store();
    const existing = seedAgent(state, directory, "Alpha");
    state.routines.set(existing.id, [
      {
        id: "routine-existing",
        agentId: existing.id,
        name: "Daily",
        instruction: "Do the daily work.",
        active: true,
        timezone: "UTC",
        trigger: {
          id: "trigger-existing",
          routineId: "routine-existing",
          schedule: { kind: "hourly", minute: 0 },
          nextRunAt: "2026-10-27T01:00:00.000Z",
          createdAt: "2026-10-27T00:00:00.000Z",
          updatedAt: "2026-10-27T00:00:00.000Z",
        },
        createdAt: "2026-10-27T00:00:00.000Z",
        updatedAt: "2026-10-27T00:00:00.000Z",
      },
    ]);
    await writeMigration(join(directory, "instance-transfer-migrations.json"), "local", MIGRATION_ALPHA, {
      agents: {
        alpha: {
          agentId: existing.id,
          files: false,
          done: false,
          skills: {},
          routines: { daily: "routine-existing" },
          memories: {},
        },
      },
      updatedAt: new Date(0).toISOString(),
    });

    const transfer = service(directory, state);
    const preview = await Effect.runPromise(transfer.stageBytes(archive()));
    const applied = await Effect.runPromise(
      transfer.apply({ token: preview.token, keys: [AGENT.key], includeSettings: false }),
    );

    expect(applied.migration).toEqual({ id: MIGRATION_ALPHA, resumed: true });
    expect(applied.agents.map((agent) => agent.id)).toEqual([existing.id]);
    expect(state.agents.size).toBe(1);
    expect([...state.routines.values()][0]).toHaveLength(1);
    expect([...state.memories.values()][0]).toHaveLength(1);
  });

  it("rolls back only the agents its own migration created", async () => {
    const directory = await root();
    const state = store();
    const transfer = service(directory, state);
    const kept = seedAgent(state, directory, "Kept by hand");

    const alpha = await Effect.runPromise(transfer.stageBytes(archive([AGENT])));
    const alphaResult = await Effect.runPromise(
      transfer.apply({ token: alpha.token, keys: [AGENT.key], includeSettings: false }),
    );
    const beta = await Effect.runPromise(transfer.stageBytes(archive([BETA])));
    const betaResult = await Effect.runPromise(
      transfer.apply({ token: beta.token, keys: [BETA.key], includeSettings: false }),
    );
    expect(state.agents.size).toBe(3);

    const rolledBack = await Effect.runPromise(transfer.rollback(MIGRATION_ALPHA));

    expect(rolledBack).toEqual({ agents: 1 });
    expect(state.agents.has(alphaResult.agents[0]?.id ?? "")).toBe(false);
    expect(state.agents.has(betaResult.agents[0]?.id ?? "")).toBe(true);
    expect(state.agents.has(kept.id)).toBe(true);
    expect(state.removedFromSidebar).toEqual([alphaResult.agents[0]?.id]);

    // The ledger entry is gone, so a second rollback changes nothing.
    expect(await Effect.runPromise(transfer.rollback(MIGRATION_ALPHA))).toEqual({ agents: 0 });
    expect(state.agents.has(betaResult.agents[0]?.id ?? "")).toBe(true);
  });

  it("keeps an agent that a rollback could not delete for a later attempt", async () => {
    const directory = await root();
    const state = store();
    const transfer = service(directory, state);

    const preview = await Effect.runPromise(transfer.stageBytes(archive()));
    const applied = await Effect.runPromise(
      transfer.apply({ token: preview.token, keys: [AGENT.key], includeSettings: false }),
    );
    const agentId = applied.agents[0]?.id ?? "";
    state.failing.add(agentId);

    expect(await Effect.runPromise(transfer.rollback(MIGRATION_ALPHA))).toEqual({ agents: 0 });
    expect(state.agents.has(agentId)).toBe(true);

    state.failing.delete(agentId);
    expect(await Effect.runPromise(transfer.rollback(MIGRATION_ALPHA))).toEqual({ agents: 1 });
    expect(state.agents.has(agentId)).toBe(false);
  });

  it("archives the source of a move under its migration id and removes the source agents", async () => {
    const directory = await root();
    const state = store();
    const transfer = service(directory, state);
    const moving = seedAgent(state, directory, "Moving");
    const bytes = archive();

    await Effect.runPromise(transfer.keepForMove(MIGRATION_ALPHA, bytes));
    const archived = await Effect.runPromise(transfer.archiveMove(MIGRATION_ALPHA));

    const fileName = `openbot-transfer-move-${MIGRATION_ALPHA}.zip`;
    expect(archived).toEqual({ fileName, directory: join(directory, "Archives") });
    expect([...new Uint8Array(await readFile(join(directory, "Archives", fileName)))]).toEqual([...bytes]);
    expect(await readdir(join(directory, "instance-transfer-moves"))).toEqual([]);

    const removed = await Effect.runPromise(transfer.deleteSourceAgents([{ id: moving.id, name: moving.name }]));
    expect(removed).toEqual({ moved: [moving.id], retained: [] });
    expect(state.agents.has(moving.id)).toBe(false);
    expect(state.removedFromSidebar).toEqual([moving.id]);
  });

  it("replaces an earlier archive of the same move and keeps it for a retry", async () => {
    const directory = await root();
    const state = store();
    const transfer = service(directory, state);
    const fileName = `openbot-transfer-move-${MIGRATION_ALPHA}.zip`;

    await Effect.runPromise(transfer.keepForMove(MIGRATION_ALPHA, archive()));
    await Effect.runPromise(transfer.archiveMove(MIGRATION_ALPHA));
    const fresh = archive([{ ...AGENT, description: "Changed after the first archive." }]);
    await Effect.runPromise(transfer.keepForMove(MIGRATION_ALPHA, fresh));

    expect(await Effect.runPromise(transfer.archiveMove(MIGRATION_ALPHA))).toEqual({
      fileName,
      directory: join(directory, "Archives"),
    });
    expect([...new Uint8Array(await readFile(join(directory, "Archives", fileName)))]).toEqual([...fresh]);

    // The held bytes are gone, so a retry keeps the archive from the confirmed move.
    expect(await Effect.runPromise(transfer.archiveMove(MIGRATION_ALPHA))).toEqual({
      fileName,
      directory: join(directory, "Archives"),
    });
  });

  it("reports a source agent it could not remove and keeps its archive", async () => {
    const directory = await root();
    const state = store();
    const transfer = service(directory, state);
    const stuck = seedAgent(state, directory, "Stuck");
    const gone = seedAgent(state, directory, "Already gone");
    state.failing.add(stuck.id);

    await Effect.runPromise(transfer.keepForMove(MIGRATION_BETA, archive([BETA])));
    await Effect.runPromise(transfer.archiveMove(MIGRATION_BETA));

    const removed = await Effect.runPromise(
      transfer.deleteSourceAgents([
        { id: stuck.id, name: stuck.name },
        { id: gone.id, name: gone.name },
      ]),
    );

    expect(removed.moved).toEqual([gone.id]);
    expect(removed.retained).toEqual([
      { agentId: stuck.id, name: stuck.name, reason: expect.stringContaining("busy") },
    ]);
    expect(state.agents.has(stuck.id)).toBe(true);
    expect(state.agents.has(gone.id)).toBe(false);
    expect(await readdir(join(directory, "Archives"))).toEqual([`openbot-transfer-move-${MIGRATION_BETA}.zip`]);
  });

  it("refuses a move file name it did not make", async () => {
    const directory = await root();
    const state = store();
    const transfer = service(directory, state);

    expect(() => transfer.archivePath("../../another.zip")).toThrow("not an archive");
    expect(() => transfer.archivePath("openbot-transfer-move-nothex.zip")).toThrow("not an archive");
    expect(transfer.archivePath(`openbot-transfer-move-${MIGRATION_ALPHA}.zip`)).toBe(
      join(directory, "Archives", `openbot-transfer-move-${MIGRATION_ALPHA}.zip`),
    );
  });
});

/** An archive whose one agent carries a `conversations.json` with the given bytes or text. */
function historyArchive(conversations: string | Uint8Array): Uint8Array {
  const path = `agents/${AGENT.key}/${CONVERSATIONS_FILE}`;
  const manifest = {
    format: INSTANCE_TRANSFER_FORMAT,
    version: INSTANCE_TRANSFER_VERSION,
    source: { appVersion: "test", exportedAt: "2026-10-27T00:00:00.000Z" },
    agents: [{ ...AGENT, conversations: path }],
    settings: null,
    shared: null,
    signedIn: [],
  };
  return zipSync({
    [INSTANCE_TRANSFER_MANIFEST]: strToU8(JSON.stringify(manifest)),
    [path]: typeof conversations === "string" ? strToU8(conversations) : conversations,
  });
}

const CREATED = "2026-10-01T10:00:00.000Z";

describe("instance transfer chat history", () => {
  it("exports conversations without anything that acts, and maps a sender to its key in the file", async () => {
    const directory = await root();
    const state = store();
    const source = seedAgent(state, directory, "Source");
    const peer = seedAgent(state, directory, "Peer");
    // What the database may hold beside a message. The file must not carry any of it.
    const working: ConversationMessage = JSON.parse(
      JSON.stringify({
        id: "m2",
        author: "agent",
        text: "working",
        createdAt: "2026-10-01T10:00:01.000Z",
        status: "streaming",
        senderAgentId: peer.id,
        turnId: "turn-1",
        delivery: { id: "delivery-1", status: "queued", position: 1 },
        routine: { routineId: "r", runId: "run", name: "Daily", scheduledFor: CREATED },
        attachments: [
          {
            id: "att-1",
            name: "notes.txt",
            size: 4,
            kind: "file",
            mimeType: "text/plain",
            previewKind: "none",
            previewUrl: "file:///private/notes.txt",
          },
        ],
      }),
    );
    state.threads.set(source.id, [
      {
        threadId: "thread-main",
        title: "Main",
        createdAt: CREATED,
        updatedAt: "2026-10-01T11:00:00.000Z",
        messages: [{ id: "m1", author: "user", text: "hello", createdAt: CREATED, status: "completed" }, working],
      },
    ]);
    const transfer = service(directory, state);
    const path = join(directory, "history.zip");

    await Effect.runPromise(
      transfer.exportTo(path, { agentIds: [source.id, peer.id], includeFiles: false, includeSettings: false }),
    );
    const files = unzipSync(await readFile(path));
    const manifest = JSON.parse(strFromU8(files[INSTANCE_TRANSFER_MANIFEST] ?? new Uint8Array()));
    const exported = manifest.agents.find((agent: { name: string }) => agent.name === "Source");
    const peerKey = manifest.agents.find((agent: { name: string }) => agent.name === "Peer").key;
    const history = JSON.parse(strFromU8(files[exported.conversations] ?? new Uint8Array()));

    expect(history.threads).toHaveLength(1);
    const [first, second] = history.threads[0].messages;
    expect(first).toEqual({ id: "m1", author: "user", text: "hello", createdAt: CREATED, status: "completed" });
    expect(second).toEqual({
      id: "m2",
      author: "agent",
      text: "working",
      createdAt: "2026-10-01T10:00:01.000Z",
      status: "interrupted",
      senderAgentKey: peerKey,
      attachments: [{ name: "notes.txt", size: 4, mimeType: "text/plain", kind: "file" }],
    });
    const serialized = strFromU8(files[exported.conversations] ?? new Uint8Array());
    for (const forbidden of ["delivery", "routine", "turnId", "previewUrl", "/private/notes.txt"])
      expect(serialized).not.toContain(forbidden);
  });

  it("imports a thread as read-only history, skips a bad message, and lists an attachment as not copied", async () => {
    const directory = await root();
    const state = store();
    const transfer = service(directory, state);
    const file = JSON.stringify({
      format: "openbot-conversations",
      version: 1,
      threads: [
        {
          threadId: "thread-main",
          title: "Main",
          createdAt: CREATED,
          updatedAt: CREATED,
          messages: [
            { id: "m1", author: "user", text: "hello", createdAt: CREATED, status: "completed" },
            {
              id: "m2",
              author: "agent",
              text: "partial",
              createdAt: "2026-10-01T10:00:01.000Z",
              status: "interrupted",
              senderAgentKey: AGENT.key,
              delivery: { id: "delivery-1", status: "queued", position: 1 },
              routine: { routineId: "r", runId: "run", name: "Daily", scheduledFor: CREATED },
              attachments: [{ name: "notes.txt", size: 4, mimeType: "text/plain", kind: "file" }],
            },
            { id: "m3", author: "agent", text: "bad", createdAt: CREATED, status: "streaming" },
          ],
        },
      ],
    });

    const preview = await Effect.runPromise(transfer.stageBytes(historyArchive(file)));
    const applied = await Effect.runPromise(
      transfer.apply({ token: preview.token, keys: [AGENT.key], includeSettings: false }),
    );

    const agentId = applied.agents[0]?.id ?? "";
    const threads = state.imported.get(agentId);
    expect([...(threads?.keys() ?? [])]).toEqual([importedThreadId(agentId, AGENT.key, "thread-main")]);
    const imported = [...(threads?.values() ?? [])][0];
    expect(imported?.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(imported?.messages[1]).toEqual({
      id: "m2",
      author: "agent",
      text: "partial",
      createdAt: "2026-10-01T10:00:01.000Z",
      status: "interrupted",
      senderAgentId: agentId,
    });
    expect(applied.warnings.some((warning) => warning.includes("notes.txt"))).toBe(true);
    expect(applied.warnings.some((warning) => warning.includes("invalid"))).toBe(true);
  });

  it("imports the agent and reports a history file it cannot read", async () => {
    const directory = await root();
    const state = store();
    const transfer = service(directory, state);

    const preview = await Effect.runPromise(transfer.stageBytes(historyArchive("{not json")));
    const applied = await Effect.runPromise(
      transfer.apply({ token: preview.token, keys: [AGENT.key], includeSettings: false }),
    );

    expect(applied.agents).toHaveLength(1);
    expect(state.imported.size).toBe(0);
    expect(applied.warnings.some((warning) => warning.includes("cannot be read"))).toBe(true);
  });

  it("gives the same thread id to the same agent and source thread, and a different one to another agent", () => {
    const first = importedThreadId("agent-1", AGENT.key, "thread-main");

    expect(first).toBe(importedThreadId("agent-1", AGENT.key, "thread-main"));
    expect(first).not.toBe(importedThreadId("agent-2", AGENT.key, "thread-main"));
    expect(first).toMatch(/^history-[0-9a-f]{40}$/u);
  });
});
