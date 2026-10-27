import type { ServerSummary } from "@openbot/contracts/ipc";
import { INSTANCE_TRANSFER_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { INSTANCE_TRANSFER_V2_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-v2";
import { describe, expect, it } from "vitest";
import {
  canCopyFrom,
  canCopyTo,
  copyTargetDisabledReason,
  copyTargetOptions,
  copyTargets,
  hasCopyTarget,
  resumableTarget,
} from "./copy-setup-targets";

function server(
  id: string,
  kind: ServerSummary["kind"],
  options: { role?: ServerSummary["role"]; capabilities?: string[] } = {},
): ServerSummary {
  return {
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
    id,
    name: id,
    kind,
    state: "online",
    apiUrl: null,
    remoteDesktopAvailable: false,
    logoUrl: null,
    role: options.role ?? null,
    active: true,
    compatibility:
      kind === "remote"
        ? {
            localAppVersion: "1.0.0",
            hostAppVersion: "1.0.0",
            localProtocol: { minimum: 1, maximum: 1 },
            hostProtocol: { minimum: 1, maximum: 1 },
            negotiatedProtocol: 1,
            capabilities: options.capabilities ?? [INSTANCE_TRANSFER_CAPABILITY, INSTANCE_TRANSFER_V2_CAPABILITY],
          }
        : null,
  };
}

const local = server("local", "local");
const adminRemote = server("remote-admin", "remote", { role: "admin" });
const memberRemote = server("remote-member", "remote", { role: "member" });
const oldRemote = server("remote-old", "remote", { role: "owner", capabilities: [] });
const v1Remote = server("remote-v1", "remote", {
  role: "owner",
  capabilities: [INSTANCE_TRANSFER_CAPABILITY],
});

describe("copy setup targets", () => {
  it("lets this computer copy to a joined server this account administers", () => {
    expect(copyTargets([local, adminRemote, memberRemote, oldRemote], "local")).toEqual([adminRemote]);
    expect(hasCopyTarget([local, adminRemote], "local")).toBe(true);
  });

  it("lets a joined server copy to this computer when the account administers it", () => {
    expect(copyTargets([local, adminRemote], "remote-admin")).toEqual([local]);
    expect(copyTargets([local, memberRemote], "remote-member")).toEqual([]);
  });

  it("copies between two joined servers this account administers", () => {
    const otherAdmin = server("remote-admin-2", "remote", { role: "owner" });
    expect(copyTargets([adminRemote, otherAdmin, memberRemote], "remote-admin")).toEqual([otherAdmin]);
  });

  it("refuses a joined server that does not serve instance-transfer-v1", () => {
    expect(canCopyFrom(oldRemote)).toBe(false);
    expect(canCopyTo(local, oldRemote)).toBe(false);
    expect(copyTargets([local, oldRemote], "local")).toEqual([]);
  });

  it("names why an ineligible server cannot receive a copy", () => {
    expect(copyTargetDisabledReason(local, memberRemote)).toBe("not-admin");
    expect(copyTargetDisabledReason(local, oldRemote)).toBe("no-transfer");
    expect(
      copyTargetOptions([local, memberRemote, oldRemote], "local").map((option) => [
        option.server.id,
        option.disabledReason,
      ]),
    ).toEqual([
      ["remote-member", "not-admin"],
      ["remote-old", "no-transfer"],
    ]);
  });

  it("never offers the source itself", () => {
    expect(canCopyTo(local, local)).toBe(false);
    expect(canCopyTo(adminRemote, adminRemote)).toBe(false);
  });

  it("lets a move go only to a target that records the migration", () => {
    expect(resumableTarget(local)).toBe(true);
    expect(resumableTarget(adminRemote)).toBe(true);
    expect(resumableTarget(v1Remote)).toBe(false);
    expect(copyTargetOptions([local, v1Remote], "local").map((option) => [option.server.id, option.resumable])).toEqual(
      [["remote-v1", false]],
    );
  });
});
