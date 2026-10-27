import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  decodeTransferManifest,
  INSTANCE_TRANSFER_FORMAT,
  INSTANCE_TRANSFER_VERSION,
} from "./instance-transfer-manifest";

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
  routines: [],
  memories: [],
};

/** A manifest file as bytes, with `overrides` set on top of a valid version 1 file. */
/** The top-level fields a test sets. Each test changes only the ones it names. */
interface FileOverrides {
  version?: unknown;
  agents?: unknown;
  futureFile?: unknown;
}

function file(overrides: FileOverrides = {}): Uint8Array {
  return strToU8(
    JSON.stringify({
      format: INSTANCE_TRANSFER_FORMAT,
      version: INSTANCE_TRANSFER_VERSION,
      source: { appVersion: "test", exportedAt: "2026-10-27T00:00:00.000Z" },
      agents: [AGENT],
      settings: null,
      shared: null,
      signedIn: [],
      ...overrides,
    }),
  );
}

describe("decodeTransferManifest version negotiation", () => {
  it("imports an equal-version file with no warnings", () => {
    const { manifest, warnings } = decodeTransferManifest(file());

    expect(manifest.version).toBe(INSTANCE_TRANSFER_VERSION);
    expect(manifest.agents.map((agent) => agent.key)).toEqual(["alpha"]);
    expect(warnings).toEqual([]);
  });

  it("imports an older file in a newer build without a format warning", () => {
    const { manifest, warnings } = decodeTransferManifest(file(), INSTANCE_TRANSFER_VERSION + 1);

    expect(manifest.agents).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("imports a newer file's known fields and says the format is newer", () => {
    const { manifest, warnings } = decodeTransferManifest(file({ version: 2 }));

    expect(manifest.version).toBe(2);
    expect(manifest.agents.map((agent) => agent.key)).toEqual(["alpha"]);
    expect(warnings.join("\n")).toContain("version 2");
  });

  it("refuses a newer file whose required shape changed, and names the format it needs", () => {
    expect(() => decodeTransferManifest(file({ version: 2, agents: "not a list" }))).toThrow(
      "This file needs transfer format 2, and this version of OpenBot reads up to format 1.",
    );
  });

  it("refuses an equal-version file whose required shape is wrong as not a transfer file", () => {
    expect(() => decodeTransferManifest(file({ agents: "not a list" }))).toThrow("not an OpenBot transfer file");
  });

  it.each([0, 1.5, "1", null])("refuses a format version of %j as not a transfer file", (version) => {
    expect(() => decodeTransferManifest(file({ version }))).toThrow("not an OpenBot transfer file");
  });
});

describe("decodeTransferManifest unknown fields", () => {
  it("keeps the known fields of a file with unknown ones and lists each as skipped", () => {
    const { manifest, warnings } = decodeTransferManifest(
      file({
        futureFile: true,
        agents: [{ ...AGENT, futureAgentField: "x" }],
      }),
    );

    expect(manifest.agents.map((agent) => agent.key)).toEqual(["alpha"]);
    const text = warnings.join("\n");
    expect(text).toContain("futureFile");
    expect(text).toContain("futureAgentField");
    expect(text).toContain("Agent 1");
  });

  it("imports an agent without a conversations file, and one with it", () => {
    const withHistory = { ...AGENT, conversations: "agents/alpha/conversations.json" };
    const { manifest, warnings } = decodeTransferManifest(file({ agents: [withHistory] }));

    expect(manifest.agents[0]?.conversations).toBe("agents/alpha/conversations.json");
    expect(warnings).toEqual([]);
  });

  it("skips an agent whose conversations file is outside its folder and keeps the others", () => {
    const { manifest, warnings } = decodeTransferManifest(
      file({
        agents: [
          { ...AGENT, conversations: "agents/beta/conversations.json" },
          { ...AGENT, key: "beta", name: "Beta" },
        ],
      }),
    );

    expect(manifest.agents.map((agent) => agent.key)).toEqual(["beta"]);
    expect(warnings.join("\n")).toContain("Agent 1");
  });
});
