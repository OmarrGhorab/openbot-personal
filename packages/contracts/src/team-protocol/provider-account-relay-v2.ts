// Frozen optional provider-account-relay-v2 wire contract.
//
// `provider-account-relay-v1` relays the sign-in of an account after the first for Codex and Claude
// only, and its provider list is frozen. This capability adds the same start route on its own path,
// for Codex, Claude and Gemini (`antigravity`). The Gemini account sign-in is the same ACP
// `authenticate` call as the provider's own sign-in, whose page `sign-in-relay-v1` already relays: it
// returns to the loopback listener of the account's process on the host. The released
// `sign-in-relay-v1` routes `status`, `complete` and `cancel` then run the flow, as for v1.
//
// A host advertises it only with `sign-in-relay-v1` and `provider-accounts-v1`, beside v1. A client
// uses it when the host advertises it, and v1 otherwise. One account sign-in runs for each provider,
// a new start replaces the one that runs, and a new account that did not sign in goes with it. A
// member cannot use the route; `requireAdmin` on the host is the only gate.
import { adminRoute, count, fields, identifier, nullable, type OptionalRouteCodec, oneOf } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY = "provider-account-relay-v2";

export const PROVIDER_ACCOUNT_RELAY_V2_ROUTES = {
  start: "/v1/admin/sign-in-relay/provider-account-v2/start",
} as const;

/** The providers whose account sign-in `start` relays: those of `sign-in-relay-v1` that hold accounts. */
export const PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS = ["codex", "claude", "antigravity"] as const;

export const PROVIDER_ACCOUNT_RELAY_V2_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_RELAY_V2_ROUTES.start,
    adminRoute(
      fields({ provider: oneOf(...PROVIDER_ACCOUNT_RELAY_V2_PROVIDERS), accountId: nullable(PROVIDER_ACCOUNT_ID) }),
      fields({ flowId: identifier, expiresAt: count }),
    ),
  ],
]);
