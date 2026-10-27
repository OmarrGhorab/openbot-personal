import type { InstanceTransferPreview } from "@openbot/contracts/ipc";
import { parseCopyInstanceTransferInput } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { prepareCopy } from "./instance-transfer-copy";
import { migrationIdFor } from "./instance-transfer-ledger";

const PREVIEW: InstanceTransferPreview = {
  token: "token",
  appVersion: "1.0.0",
  exportedAt: null,
  agents: [],
  hasSettings: false,
  warnings: [],
  migrationId: null,
};

const MIGRATION_ID = "a".repeat(64);

const AGENT: InstanceTransferPreview["agents"][number] = {
  key: "alpha",
  name: "Alpha",
  title: "First agent",
  description: "A test agent.",
  avatarUrl: null,
  skillCount: 0,
  routineCount: 0,
  memoryCount: 0,
  fileCount: 0,
  fileBytes: 0,
  nameExists: false,
};

function options(overrides: Partial<Parameters<typeof prepareCopy>[0]> = {}) {
  return {
    readSource: async () => ({ bytes: new Uint8Array([1]), warnings: [] }),
    remoteTarget: false,
    stageRemote: vi.fn(async () => PREVIEW),
    stageLocal: vi.fn(async () => PREVIEW),
    maxRemoteBytes: 10,
    mode: "copy" as const,
    resumableTarget: true,
    ...overrides,
  };
}

describe("prepareCopy", () => {
  it("stages the source archive on a remote target and merges the warnings", async () => {
    const stageRemote = vi.fn(async () => ({ ...PREVIEW, warnings: ["remote warning"] }));
    const stageLocal = vi.fn(async () => PREVIEW);

    const preview = await prepareCopy(
      options({
        readSource: async () => ({ bytes: new Uint8Array([1]), warnings: ["source warning"] }),
        remoteTarget: true,
        stageRemote,
        stageLocal,
      }),
    );

    expect(stageRemote).toHaveBeenCalledWith(new Uint8Array([1]));
    expect(stageLocal).not.toHaveBeenCalled();
    expect(preview.warnings).toEqual(["source warning", "remote warning"]);
  });

  it("stages on this computer for a local target", async () => {
    const stageRemote = vi.fn(async () => PREVIEW);
    const stageLocal = vi.fn(async () => ({ ...PREVIEW, warnings: ["local warning"] }));

    const preview = await prepareCopy(options({ stageRemote, stageLocal }));

    expect(stageLocal).toHaveBeenCalledWith(new Uint8Array([1]));
    expect(stageRemote).not.toHaveBeenCalled();
    expect(preview.warnings).toEqual(["local warning"]);
  });

  it("refuses an archive over the remote limit before staging it", async () => {
    const stageRemote = vi.fn(async () => PREVIEW);

    await expect(
      prepareCopy(
        options({
          readSource: async () => ({ bytes: new Uint8Array(11), warnings: [] }),
          remoteTarget: true,
          stageRemote,
        }),
      ),
    ).rejects.toThrow("100 MB");
    expect(stageRemote).not.toHaveBeenCalled();
  });

  it("accepts an archive exactly at the remote limit", async () => {
    const stageRemote = vi.fn(async () => PREVIEW);

    await prepareCopy(
      options({
        readSource: async () => ({ bytes: new Uint8Array(10), warnings: [] }),
        remoteTarget: true,
        stageRemote,
      }),
    );

    expect(stageRemote).toHaveBeenCalledOnce();
  });

  it("refuses a joined target from the estimate before the source is read", async () => {
    const readSource = vi.fn(async () => ({ bytes: new Uint8Array([1]), warnings: [] }));
    const stageRemote = vi.fn(async () => PREVIEW);

    // Ten bytes is the limit in these tests, so 11 is one byte over; the message rounds to megabytes.
    await expect(
      prepareCopy(options({ estimate: async () => 11, readSource, remoteTarget: true, stageRemote })),
    ).rejects.toThrow("This setup is about 1 MB, and a joined server takes at most 1 MB");
    expect(readSource).not.toHaveBeenCalled();
    expect(stageRemote).not.toHaveBeenCalled();
  });

  it("reads the source when the estimate is exactly the remote limit", async () => {
    const readSource = vi.fn(async () => ({ bytes: new Uint8Array([1]), warnings: [] }));

    await prepareCopy(options({ estimate: async () => 10, readSource, remoteTarget: true }));

    expect(readSource).toHaveBeenCalledOnce();
  });

  it("does not estimate a copy to this computer", async () => {
    const estimate = vi.fn(async () => 11);

    await prepareCopy(options({ estimate }));

    expect(estimate).not.toHaveBeenCalled();
  });

  it("does not stage anything when the source cannot be read", async () => {
    const stageRemote = vi.fn(async () => PREVIEW);

    await expect(
      prepareCopy(
        options({
          readSource: async () => {
            throw new Error("source failed");
          },
          remoteTarget: true,
          stageRemote,
        }),
      ),
    ).rejects.toThrow("source failed");
    expect(stageRemote).not.toHaveBeenCalled();
  });

  it("names the migration from the preview's keys when the target is v1", async () => {
    const preview = await prepareCopy(
      options({
        stageLocal: vi.fn(async () => ({ ...PREVIEW, agents: [AGENT] })),
      }),
    );

    expect(preview.migrationId).toBe(migrationIdFor(["alpha"]));
  });

  it("keeps the source bytes under the preview's migration id for a move", async () => {
    const retain = vi.fn(async () => undefined);
    const preview = await prepareCopy(
      options({
        mode: "move",
        stageLocal: vi.fn(async () => ({ ...PREVIEW, migrationId: MIGRATION_ID })),
        retain,
      }),
    );

    expect(retain).toHaveBeenCalledWith(MIGRATION_ID, new Uint8Array([1]));
    expect(preview.migrationId).toBe(MIGRATION_ID);
  });

  it("refuses a move to a target that cannot confirm it", async () => {
    const readSource = vi.fn(async () => ({ bytes: new Uint8Array([1]), warnings: [] }));

    await expect(prepareCopy(options({ mode: "move", resumableTarget: false, readSource }))).rejects.toThrow(
      "cannot confirm a move",
    );
    expect(readSource).not.toHaveBeenCalled();
  });

  it("discards the staged token when the move's bytes cannot be kept", async () => {
    const discardStaged = vi.fn(async () => undefined);

    await expect(
      prepareCopy(
        options({
          mode: "move",
          stageLocal: vi.fn(async () => ({ ...PREVIEW, migrationId: MIGRATION_ID })),
          retain: async () => {
            throw new Error("disk full");
          },
          discardStaged,
        }),
      ),
    ).rejects.toThrow("disk full");
    expect(discardStaged).toHaveBeenCalledWith("token");
  });
});

describe("parseCopyInstanceTransferInput", () => {
  const input = {
    sourceServerId: "local",
    targetServerId: "remote",
    agentIds: ["agent-1"],
    includeFiles: true,
    includeSettings: false,
    mode: "copy",
  };

  it("accepts two different servers, the export choices and a mode", () => {
    expect(parseCopyInstanceTransferInput(input)).toEqual(input);
  });

  it("refuses one server as both source and target", () => {
    expect(() => parseCopyInstanceTransferInput({ ...input, targetServerId: "local" })).toThrow("Invalid copy request");
  });

  it("refuses an input without two server ids", () => {
    expect(() => parseCopyInstanceTransferInput({ ...input, targetServerId: "" })).toThrow("Invalid copy request");
  });

  it("refuses an unknown mode", () => {
    expect(() => parseCopyInstanceTransferInput({ ...input, mode: "clone" })).toThrow("Invalid copy request");
  });
});
