import type { ServerSummary } from "@openbot/contracts/ipc";
import { INSTANCE_TRANSFER_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { INSTANCE_TRANSFER_V2_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-v2";
import { INSTANCE_TRANSFER_V3_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-v3";
import { serverRoleCanAdminister, serverSupportsCapability } from "./server-capabilities";

/** Why a server cannot receive a copy. */
export type CopyTargetReason = "not-admin" | "no-transfer";

export interface CopyTargetOption {
  server: ServerSummary;
  disabledReason: CopyTargetReason | null;
  /** The target records the migration, so a move can be confirmed and a failed run rolled back. */
  resumable: boolean;
  /** Both sides can seal and open secrets for this migration, so the dialog may offer them. */
  secrets: boolean;
}

/**
 * A joined source must let this account administer it and serve `instance-transfer-v1`. This
 * computer can always send.
 */
export function canCopyFrom(server: ServerSummary | null | undefined): server is ServerSummary {
  if (!server) return false;
  if (server.kind === "local") return true;
  return serverRoleCanAdminister(server) && serverSupportsCapability(server, INSTANCE_TRANSFER_CAPABILITY);
}

/** Why `target` cannot receive `from`'s setup, or null when it can. */
export function copyTargetDisabledReason(from: ServerSummary, target: ServerSummary): CopyTargetReason | null {
  if (target.kind === "local") return from.kind === "remote" ? null : "not-admin";
  if (!serverRoleCanAdminister(target)) return "not-admin";
  if (!serverSupportsCapability(target, INSTANCE_TRANSFER_CAPABILITY)) return "no-transfer";
  return null;
}

/**
 * Whether a target can be trusted to finish a move: it must serve both `instance-transfer-v1` and
 * `instance-transfer-v2`, since v2 names the migration and deletes only what it created.
 */
export function resumableTarget(target: ServerSummary): boolean {
  if (target.kind === "local") return true;
  return (
    serverSupportsCapability(target, INSTANCE_TRANSFER_CAPABILITY) &&
    serverSupportsCapability(target, INSTANCE_TRANSFER_V2_CAPABILITY)
  );
}

/** Whether this computer can read the secrets of `server` for a transfer. */
function canSendSecrets(server: ServerSummary | null | undefined): server is ServerSummary {
  if (!server) return false;
  if (server.kind === "local") return true;
  return serverRoleCanAdminister(server) && serverSupportsCapability(server, INSTANCE_TRANSFER_V3_CAPABILITY);
}

/**
 * Whether `target` can receive sealed secrets: it has the migration ledger of `instance-transfer-v2`
 * and the sealed hand-off of `instance-transfer-v3`.
 */
function secretsTarget(target: ServerSummary): boolean {
  if (target.kind === "local") return true;
  return resumableTarget(target) && serverSupportsCapability(target, INSTANCE_TRANSFER_V3_CAPABILITY);
}

/** Whether `target` can receive `from`'s setup. A server never receives from itself. */
export function canCopyTo(from: ServerSummary, target: ServerSummary): boolean {
  return target.id !== from.id && copyTargetDisabledReason(from, target) === null;
}

/** Every other server, with the reason it cannot receive `sourceId`'s setup. */
export function copyTargetOptions(servers: readonly ServerSummary[], sourceId: string): CopyTargetOption[] {
  const from = servers.find((server) => server.id === sourceId);
  if (!canCopyFrom(from)) return [];
  return servers
    .filter((server) => server.id !== from.id)
    .map((server) => ({
      server,
      disabledReason: copyTargetDisabledReason(from, server),
      resumable: resumableTarget(server),
      secrets: canSendSecrets(from) && secretsTarget(server),
    }));
}

/** Every server that can receive `sourceId`'s setup, in the order of the rail. */
export function copyTargets(servers: readonly ServerSummary[], sourceId: string): ServerSummary[] {
  return copyTargetOptions(servers, sourceId)
    .filter((option) => option.disabledReason === null)
    .map((option) => option.server);
}

/** Whether the server menu offers Copy setup to… for `sourceId`. */
export function hasCopyTarget(servers: readonly ServerSummary[], sourceId: string): boolean {
  return copyTargets(servers, sourceId).length > 0;
}
