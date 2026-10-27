// @vitest-environment node

import {
  decodeAgentImportResult,
  decodeInstanceTransferResult,
  decodeMoveInstanceSourceResult,
  decodeRemoteInstanceTransferResult,
  decodeRollbackInstanceTransferResult,
  parseRollbackInstanceTransferInput,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";

// The preload decodes these results with the same contracts decoders. A remote import or transfer
// lists the host's agents, and a newer host can run an agent on a provider that this OpenBot does not
// know. The host has already done the import, so the result must still decode.

const AGENT = {
  id: "agent-1",
  name: "Ada",
  title: "Researcher",
  description: "",
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  notifications: true,
  threadId: null,
  workspacePath: "/Users/ada/OpenBot/Agents/Ada",
  preview: "",
  updatedAt: null,
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};

const FOREIGN_AGENT = { ...AGENT, id: "agent-2", provider: "omp", model: "omp/default" };

const IMPORT_RESULT = { skipped: [], channels: [], skippedChannels: [], warnings: [] };
const TRANSFER_RESULT = { skipped: [], signIn: [], warnings: [], migration: null };

describe("agent import result decoding", () => {
  it("keeps an agent on a provider that this build does not know", () => {
    const result = decodeAgentImportResult({ ...IMPORT_RESULT, agents: [AGENT, FOREIGN_AGENT] });
    expect(result.agents.map((agent) => agent.provider)).toEqual(["codex", "omp"]);
  });

  it("rejects an agent whose provider is not a provider id", () => {
    expect(() => decodeAgentImportResult({ ...IMPORT_RESULT, agents: [{ ...AGENT, provider: "Not An Id" }] })).toThrow(
      "Invalid import result.",
    );
  });
});

describe("instance transfer result decoding", () => {
  it("keeps an agent on a provider that this build does not know", () => {
    const result = decodeInstanceTransferResult({ ...TRANSFER_RESULT, agents: [AGENT, FOREIGN_AGENT] });
    expect(result.agents.map((agent) => agent.provider)).toEqual(["codex", "omp"]);
  });

  it("rejects an agent whose provider is not a provider id", () => {
    expect(() =>
      decodeInstanceTransferResult({ ...TRANSFER_RESULT, agents: [{ ...AGENT, provider: "Not An Id" }] }),
    ).toThrow("Invalid transfer result.");
  });

  it("keeps a local sign-in list closed", () => {
    expect(() => decodeInstanceTransferResult({ ...TRANSFER_RESULT, agents: [], signIn: ["omp"] })).toThrow(
      "Invalid transfer result.",
    );
  });

  it("keeps only the remote sign-ins that this build can start", () => {
    const result = decodeRemoteInstanceTransferResult({
      ...TRANSFER_RESULT,
      agents: [{ agentId: "agent-2", name: "Ada" }],
      signIn: ["claude", "omp"],
    });
    expect(result.signIn).toEqual(["claude"]);
  });

  it("rejects a remote sign-in that is not a provider id", () => {
    expect(() =>
      decodeRemoteInstanceTransferResult({ ...TRANSFER_RESULT, agents: [], signIn: ["claude", "Not An Id"] }),
    ).toThrow("Invalid transfer result.");
  });

  it("reads a v1 host's result without a migration as null", () => {
    const result = decodeRemoteInstanceTransferResult({
      skipped: [],
      signIn: [],
      warnings: [],
      agents: [{ agentId: "agent-2", name: "Ada" }],
    });
    expect(result.migration).toBeNull();
  });

  it("reads a v2 host's migration", () => {
    const result = decodeRemoteInstanceTransferResult({
      ...TRANSFER_RESULT,
      agents: [],
      migration: { id: "migration-1", resumed: true },
    });
    expect(result.migration).toEqual({ id: "migration-1", resumed: true });
  });

  it("rejects a migration without its resumed flag", () => {
    expect(() =>
      decodeInstanceTransferResult({
        ...TRANSFER_RESULT,
        agents: [],
        migration: { id: "migration-1" },
      }),
    ).toThrow("Invalid transfer migration.");
  });
});

describe("instance transfer move and rollback decoding", () => {
  it("reads a rollback result", () => {
    expect(decodeRollbackInstanceTransferResult({ agents: 2 })).toEqual({ agents: 2 });
  });

  it("rejects a rollback count that is not a whole number", () => {
    expect(() => decodeRollbackInstanceTransferResult({ agents: 1.5 })).toThrow("Invalid rollback result.");
  });

  it("reads a move result with a retained agent", () => {
    const result = decodeMoveInstanceSourceResult({
      archiveFileName: `openbot-transfer-move-${"a".repeat(64)}.zip`,
      archiveDirectory: "/Users/ada/OpenBot/Archives",
      movedAgentIds: ["agent-1"],
      retained: [{ agentId: "agent-2", name: "Ada", reason: "The server is offline." }],
      warnings: [],
    });
    expect(result.retained).toEqual([{ agentId: "agent-2", name: "Ada", reason: "The server is offline." }]);
  });

  it("rejects a move archive name that is not a file name", () => {
    expect(() =>
      decodeMoveInstanceSourceResult({
        archiveFileName: "openbot-transfer-move-nothex.zip",
        archiveDirectory: "/Users/ada/OpenBot/Archives",
        movedAgentIds: [],
        retained: [],
        warnings: [],
      }),
    ).toThrow("Invalid move result.");
  });

  it("requires the target and the migration for a rollback", () => {
    expect(parseRollbackInstanceTransferInput({ targetServerId: "local", migrationId: "migration-1" })).toEqual({
      targetServerId: "local",
      migrationId: "migration-1",
    });
    expect(() => parseRollbackInstanceTransferInput({ migrationId: "migration-1" })).toThrow(
      "Invalid rollback request.",
    );
  });
});
