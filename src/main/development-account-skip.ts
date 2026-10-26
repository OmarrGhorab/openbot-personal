import type { AppVariant, CentralAuthUser } from "@openbot/contracts/ipc";

/**
 * The account a development start uses when it does not contact the account service.
 *
 * The id stays the same across starts, so this computer's local host stays bound to one
 * owner. It is not a session at the account service, and nothing writes it to the session file.
 */
export const DEVELOPMENT_SKIP_ACCOUNT: CentralAuthUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "local-dev@openbot.invalid",
  name: "Local development",
  avatarUrl: null,
};

/**
 * True only when the variable is exactly `1`.
 *
 * A packaged build honors it. The variable is the opt-in, and a start without it is unchanged.
 * Any other value, including `true`, stays off.
 */
function developmentSkipAccountOptIn(value: string | undefined): boolean {
  return value === "1";
}

/**
 * The startup skip.
 *
 * `OPENBOT_DEV_REMOTE_ROLE` of `host` or `client` already signs in against the local account
 * API, so the skip does not replace that path.
 */
export function startupSkipsAccountService(value: string | undefined, remoteRole: "host" | "client" | null): boolean {
  return developmentSkipAccountOptIn(value) && remoteRole === null;
}

/** The sign-in screen action. A production variant never offers it. */
export function continueWithoutAccountAllowed(variant: AppVariant): boolean {
  return variant !== "production";
}
