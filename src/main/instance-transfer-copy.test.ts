import type { InstanceTransferPreview } from "@openbot/contracts/ipc";
import { parseCopyInstanceTransferInput } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { prepareCopy } from "./instance-transfer-copy";

const PREVIEW: InstanceTransferPreview = {
  token: "token",
  appVersion: "1.0.0",
  exportedAt: null,
  agents: [],
  hasSettings: false,
  warnings: [],
};

describe("prepareCopy", () => {
  it("stages the source archive on a remote target and merges the warnings", async () => {
    const stageRemote = vi.fn(async () => ({ ...PREVIEW, warnings: ["remote warning"] }));
    const stageLocal = vi.fn(async () => PREVIEW);

    const preview = await prepareCopy({
      readSource: async () => ({ bytes: new Uint8Array([1]), warnings: ["source warning"] }),
      remoteTarget: true,
      stageRemote,
      stageLocal,
      maxRemoteBytes: 10,
    });

    expect(stageRemote).toHaveBeenCalledWith(new Uint8Array([1]));
    expect(stageLocal).not.toHaveBeenCalled();
    expect(preview.warnings).toEqual(["source warning", "remote warning"]);
  });

  it("stages on this computer for a local target", async () => {
    const stageRemote = vi.fn(async () => PREVIEW);
    const stageLocal = vi.fn(async () => ({ ...PREVIEW, warnings: ["local warning"] }));

    const preview = await prepareCopy({
      readSource: async () => ({ bytes: new Uint8Array([1]), warnings: [] }),
      remoteTarget: false,
      stageRemote,
      stageLocal,
      maxRemoteBytes: 10,
    });

    expect(stageLocal).toHaveBeenCalledWith(new Uint8Array([1]));
    expect(stageRemote).not.toHaveBeenCalled();
    expect(preview.warnings).toEqual(["local warning"]);
  });

  it("refuses an archive over the remote limit before staging it", async () => {
    const stageRemote = vi.fn(async () => PREVIEW);

    await expect(
      prepareCopy({
        readSource: async () => ({ bytes: new Uint8Array(11), warnings: [] }),
        remoteTarget: true,
        stageRemote,
        stageLocal: async () => PREVIEW,
        maxRemoteBytes: 10,
      }),
    ).rejects.toThrow("100 MB");
    expect(stageRemote).not.toHaveBeenCalled();
  });

  it("accepts an archive exactly at the remote limit", async () => {
    const stageRemote = vi.fn(async () => PREVIEW);

    await prepareCopy({
      readSource: async () => ({ bytes: new Uint8Array(10), warnings: [] }),
      remoteTarget: true,
      stageRemote,
      stageLocal: async () => PREVIEW,
      maxRemoteBytes: 10,
    });

    expect(stageRemote).toHaveBeenCalledOnce();
  });

  it("does not stage anything when the source cannot be read", async () => {
    const stageRemote = vi.fn(async () => PREVIEW);

    await expect(
      prepareCopy({
        readSource: async () => {
          throw new Error("source failed");
        },
        remoteTarget: true,
        stageRemote,
        stageLocal: async () => PREVIEW,
        maxRemoteBytes: 10,
      }),
    ).rejects.toThrow("source failed");
    expect(stageRemote).not.toHaveBeenCalled();
  });
});

describe("parseCopyInstanceTransferInput", () => {
  const input = {
    sourceServerId: "local",
    targetServerId: "remote",
    agentIds: ["agent-1"],
    includeFiles: true,
    includeSettings: false,
  };

  it("accepts two different servers and the export choices", () => {
    expect(parseCopyInstanceTransferInput(input)).toEqual(input);
  });

  it("refuses one server as both source and target", () => {
    expect(() => parseCopyInstanceTransferInput({ ...input, targetServerId: "local" })).toThrow("Invalid copy request");
  });

  it("refuses an input without two server ids", () => {
    expect(() => parseCopyInstanceTransferInput({ ...input, targetServerId: "" })).toThrow("Invalid copy request");
  });
});
