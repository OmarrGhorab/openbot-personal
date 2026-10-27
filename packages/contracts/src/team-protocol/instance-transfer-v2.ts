// Frozen optional instance-transfer-v2 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can apply a staged `instance-transfer-v1` archive and receive the target's migration id and
// whether this run resumed an earlier one. `rollback` deletes only the agents that migration
// created. The archive, staging, preview and size rules stay on `instance-transfer-v1`; this
// capability only adds what a move needs to confirm the target and what a failed run needs to undo.
import {
  adminRoute,
  boolean,
  count,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const INSTANCE_TRANSFER_V2_CAPABILITY = "instance-transfer-v2";

export const INSTANCE_TRANSFER_V2_ROUTES = {
  apply: "/v1/instance-transfer/apply-v2",
  rollback: "/v1/instance-transfer/rollback",
} as const;

const key = string(64);
const name = string(80);
const messages = list(string(500), 200);

const migration = fields({ id: identifier, resumed: boolean });

const result = fields({
  agents: list(fields({ agentId: identifier, name }), 100),
  skipped: list(fields({ key, name, reason: string(500) }), 100),
  signIn: list(string(32), 32),
  warnings: messages,
  migration: nullable(migration),
});

export const INSTANCE_TRANSFER_V2_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    INSTANCE_TRANSFER_V2_ROUTES.apply,
    adminRoute(
      fields({ token: identifier, keys: list(key, 100), includeSettings: boolean, timezone: string(255) }),
      result,
    ),
  ],
  [INSTANCE_TRANSFER_V2_ROUTES.rollback, adminRoute(fields({ migrationId: identifier }), fields({ agents: count }))],
]);
