// Checks SMTP username validation without opening a network connection.
//
// Run: bun apps/auth-api/scripts/smtp-username-e2e.ts
// It writes .openbot-build/smtp-username-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Result } from "effect";
import {
  SMTP_USERNAME_MAX_LENGTH,
  type SmtpConnector,
  type SmtpEmailConfig,
  sendPrivateEmailCode,
} from "../src/server/smtp-email-delivery";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "smtp-username-e2e");

const baseConfig = (): SmtpEmailConfig => ({
  host: "smtp.example.test",
  port: 465,
  username: "resend",
  password: "test-smtp-password",
  from: "noreply@example.test",
});

interface Attempt {
  name: string;
  message: string;
  connected: boolean;
}

const attempts: Attempt[] = [];
let error: string | undefined;

try {
  attempts.push(await attempt("resend", { ...baseConfig(), username: "resend" }));
  attempts.push(await attempt("email username", { ...baseConfig(), username: "mailer@example.test" }));
  attempts.push(await attempt("max length", { ...baseConfig(), username: "a".repeat(SMTP_USERNAME_MAX_LENGTH) }));
  attempts.push(await attempt("empty", { ...baseConfig(), username: "" }));
  attempts.push(await attempt("blank", { ...baseConfig(), username: "   " }));
  attempts.push(await attempt("line break", { ...baseConfig(), username: "resend\nAUTH" }));
  attempts.push(await attempt("too long", { ...baseConfig(), username: "a".repeat(SMTP_USERNAME_MAX_LENGTH + 1) }));
  attempts.push(await attempt("bad sender", { ...baseConfig(), username: "resend", from: "not-an-email" }));
  attempts.push(await attempt("sender line break", { ...baseConfig(), from: "noreply@example.test\nBcc: x" }));

  const byName = new Map(attempts.map((item) => [item.name, item]));
  for (const name of ["resend", "email username", "max length"]) {
    const item = byName.get(name);
    assert.ok(item);
    assert.equal(item.connected, true, name);
    assert.equal(item.message, "smtp_auth_failed", name);
  }
  for (const name of ["empty", "blank", "line break", "too long"]) {
    const item = byName.get(name);
    assert.ok(item);
    assert.equal(item.connected, false, name);
    assert.equal(item.message, "smtp_invalid_username", name);
  }
  for (const name of ["bad sender", "sender line break"]) {
    const item = byName.get(name);
    assert.ok(item);
    assert.equal(item.connected, false, name);
    assert.equal(item.message, "smtp_invalid_sender", name);
  }
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
}

const report = {
  passed: error === undefined,
  acceptedUsernames: attempts.filter((item) => item.message === "smtp_auth_failed").map((item) => item.name),
  rejectedUsernames: attempts.filter((item) => item.message === "smtp_invalid_username").map((item) => item.name),
  rejectedSenders: attempts.filter((item) => item.message === "smtp_invalid_sender").map((item) => item.name),
  ...(error ? { error } : {}),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${report.passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
);
if (!report.passed) process.exitCode = 1;

async function attempt(name: string, config: SmtpEmailConfig): Promise<Attempt> {
  let connected = false;
  const connector: SmtpConnector = () => {
    connected = true;
    throw new Error("smtp_auth_failed");
  };
  const result = await Effect.runPromise(
    Effect.result(
      sendPrivateEmailCode(
        config,
        { email: "person@example.com", code: "ABCD-EFGH", expiresAt: Date.now() + 60_000 },
        connector,
      ),
    ),
  );
  const message = Result.isFailure(result) ? result.failure.message : "sent";
  return { name, message, connected };
}
