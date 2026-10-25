import { existsSync } from "node:fs";
import { createDevelopmentTicketKeyPair, DEVELOPMENT_TICKET_KEY_ID } from "./development-secrets";
import { privateBackendEnvPath, readPrivateBackendEnv, writePrivateBackendEnv } from "./private-backend-env";

const PRIVATE_JWK = "REMOTE_TICKET_PRIVATE_JWK";
const PUBLIC_JWKS = "REMOTE_TICKET_PUBLIC_JWKS";
const KEY_ID = "REMOTE_TICKET_KEY_ID";

/**
 * Writes a ticket signing key into the private account file. The key is not printed.
 * An existing pair is kept unless `--rotate` is set.
 */
export function generateRemoteTicketKeys(environment: NodeJS.ProcessEnv = process.env): void {
  const rotate = environment.OPENBOT_TICKET_KEY_ROTATE === "1";
  const path = privateBackendEnvPath(environment);
  const current = existsSync(path) ? readPrivateBackendEnv({ ...environment, OPENBOT_BACKEND_ENV_FILE: path }) : {};
  const keyId = current[KEY_ID]?.trim() || DEVELOPMENT_TICKET_KEY_ID;
  if (current[KEY_ID]?.trim() && current[KEY_ID] !== DEVELOPMENT_TICKET_KEY_ID) {
    process.stderr.write(
      `${KEY_ID} is not ${DEVELOPMENT_TICKET_KEY_ID}. The account Worker expects ${DEVELOPMENT_TICKET_KEY_ID}.\n`,
    );
  }
  const hasPair = Boolean(current[PRIVATE_JWK]?.trim() && current[PUBLIC_JWKS]?.trim());
  if (hasPair && !rotate) {
    const kept = writePrivateBackendEnv(path, { [KEY_ID]: keyId });
    process.stdout.write(`Kept the existing ticket keys in the private environment file. ${formatWrite(kept.added)}\n`);
    return;
  }
  const pair = createDevelopmentTicketKeyPair(keyId);
  const result = writePrivateBackendEnv(
    path,
    {
      [KEY_ID]: keyId,
      [PRIVATE_JWK]: pair.privateJwk,
      [PUBLIC_JWKS]: pair.publicJwks,
    },
    { replace: rotate && hasPair },
  );
  process.stdout.write(
    `${rotate && hasPair ? "Replaced" : "Added"} the ticket keys in the private environment file. ${formatWrite([
      ...result.added,
      ...result.replaced,
    ])}\n`,
  );
}

function formatWrite(names: string[]): string {
  return names.length > 0 ? `Names: ${names.join(", ")}.` : "No names were added.";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--rotate")) {
    process.stderr.write("Use bun run api:ticket-keys with no arguments, or with --rotate.\n");
    process.exitCode = 1;
  } else {
    try {
      generateRemoteTicketKeys({
        ...process.env,
        ...(args.includes("--rotate") ? { OPENBOT_TICKET_KEY_ROTATE: "1" } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The ticket keys were not written.";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  }
}
