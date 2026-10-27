// Frozen optional instance-transfer-v3 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can list the secrets the host holds, without their values; ask the target to publish a
// short-lived key for one migration; have the source seal the chosen values to that key; and have
// the target apply them. The archive and every rule of `instance-transfer-v1` stay as they are:
// this capability is the only way a secret ever travels between two OpenBot instances.
//
// The target keeps the private key only in memory, only for a migration its ledger recorded, and
// only for five minutes. Each item is sealed on its own with X25519, HKDF-SHA256 and AES-256-GCM,
// bound to the migration id and item id; a wrong key, a tampered item and a replayed item all fail
// closed. The wire carries no plaintext and no long-lived key. Widening any of it needs a second
// capability string.
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const INSTANCE_TRANSFER_V3_CAPABILITY = "instance-transfer-v3";

export const INSTANCE_TRANSFER_V3_ROUTES = {
  secrets: "/v1/instance-transfer/secrets",
  key: "/v1/instance-transfer/secrets/key",
  seal: "/v1/instance-transfer/secrets/seal",
  apply: "/v1/instance-transfer/secrets/apply",
} as const;

/** The frozen kind and section names of `instance-transfer-v3`. */
const kind = oneOf(
  "provider-key",
  "provider-sign-in",
  "mcp-values",
  "github",
  "onepassword",
  "custom-provider",
  "mcp-sign-in",
  "bitwarden",
);
const section = oneOf("providers", "mcp", "connectors");
const status = oneOf("transferred", "already-present", "target-missing", "failed");
const label = string(2048);
const reason = string(500);

const summary = fields({
  items: list(fields({ id: identifier, kind, label, count, section, transferable: boolean }), 64),
});

const key = fields({ migrationId: identifier });
const publicKey = fields({ publicKey: string(64) });

const sealRequest = fields({
  migrationId: identifier,
  targetPublicKey: string(64),
  ids: list(identifier, 64),
});

/** One sealed value: the source's ephemeral public key, the salt, the nonce and the ciphertext. */
const sealed = fields({
  id: identifier,
  kind,
  label,
  publicKey: string(64),
  salt: string(32),
  nonce: string(32),
  ciphertext: string(16384),
});

const sealAnswer = fields({
  items: list(sealed, 64),
  failed: list(fields({ id: identifier, reason }), 64),
});

const applyRequest = fields({ migrationId: identifier, items: list(sealed, 64) });

const outcome = fields(
  { id: identifier, kind, label, status },
  // A source tells the target which item it could not seal, so the summary can show it.
  { reason: nullable(reason) },
);

const applyAnswer = fields({ outcomes: list(outcome, 64) });

export const INSTANCE_TRANSFER_V3_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [INSTANCE_TRANSFER_V3_ROUTES.secrets, adminRoute(empty, summary)],
  [INSTANCE_TRANSFER_V3_ROUTES.key, adminRoute(key, publicKey)],
  [INSTANCE_TRANSFER_V3_ROUTES.seal, adminRoute(sealRequest, sealAnswer)],
  [INSTANCE_TRANSFER_V3_ROUTES.apply, adminRoute(applyRequest, applyAnswer)],
]);
