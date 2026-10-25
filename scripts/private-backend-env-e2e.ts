// Checks the private account file, the omar Wrangler environment, and ticket-key generation.
// It does not call Cloudflare and it does not print secret values.
//
// Run: bun scripts/private-backend-env-e2e.ts
// It writes .openbot-build/private-backend-env-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertOmarDatabaseReady,
  assertOmarDeploySafe,
  OMAR_ACCOUNT_ID,
  OMAR_PLACEHOLDER_DATABASE_ID,
  OMAR_R2_BUCKETS,
  OMAR_WORKER_NAME,
  readOmarWranglerConfig,
} from "./deploy-omar-auth-api";
import { loadDevelopmentEnvironment } from "./development-environment";
import { parsePrivateBackendEnv } from "./private-backend-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "private-backend-env-e2e");
const directory = mkdtempSync(join(tmpdir(), "openbot-private-env-"));
const envPath = join(directory, "backend.env");
const project = join(directory, "project");

const report: {
  passed: boolean;
  error?: string;
  developmentCodeExposed?: boolean;
  smtpLoadedFromPrivateFile?: boolean;
  accountIdKeptOutOfDevProcess?: boolean;
  ticketKeyAppendedWithoutPrinting?: boolean;
  secondRunKeptTheSameKey?: boolean;
  omarWorker?: string;
  omarUsesWorkersDev?: boolean;
  omarRoutes?: number;
  omarR2Buckets?: string;
  omarKvNamespaces?: number;
  deployRefusesPlaceholderDatabase?: boolean;
} = { passed: false };
let error: string | undefined;

try {
  writeFileSync(
    envPath,
    [
      "AUTH_EXPOSE_DEVELOPMENT_CODE=false",
      "EMAIL_SMTP_HOST=smtp.example.test",
      "EMAIL_SMTP_PORT=465",
      "EMAIL_SMTP_USERNAME=resend",
      "EMAIL_SMTP_PASSWORD='test-smtp-password'",
      "EMAIL_FROM=noreply@example.test",
      `CLOUDFLARE_ACCOUNT_ID=${OMAR_ACCOUNT_ID}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(envPath, 0o600);
  const first = await runTicketKeys(envPath);
  const afterFirst = parsePrivateBackendEnv(readFileSync(envPath, "utf8"));
  const privateJwk = afterFirst.REMOTE_TICKET_PRIVATE_JWK ?? "";
  assert.equal(privateJwk.includes('"d"'), true);
  assert.equal(first.stdout.includes(privateJwk.slice(30, 50)), false);
  assert.equal(first.stderr.includes(privateJwk.slice(30, 50)), false);
  const second = await runTicketKeys(envPath);
  const afterSecond = parsePrivateBackendEnv(readFileSync(envPath, "utf8"));
  assert.equal(afterSecond.REMOTE_TICKET_PRIVATE_JWK === privateJwk, true);
  assert.match(second.stdout, /Kept the existing ticket keys/);
  const rotated = await runTicketKeys(envPath, ["--rotate"]);
  const afterRotate = parsePrivateBackendEnv(readFileSync(envPath, "utf8"));
  const rotatedJwk = afterRotate.REMOTE_TICKET_PRIVATE_JWK ?? "";
  assert.equal(rotatedJwk === privateJwk, false);
  assert.equal(rotated.stdout.includes(rotatedJwk.slice(30, 50)), false);

  const loaded = await loadDevelopmentEnvironment(project, {
    OPENBOT_BACKEND_ENV_FILE: envPath,
    PATH: process.env.PATH,
  });
  assert.equal(loaded.AUTH_EXPOSE_DEVELOPMENT_CODE, "true");
  assert.equal(loaded.EMAIL_SMTP_HOST, "smtp.example.test");
  assert.equal(loaded.EMAIL_SMTP_PORT, "465");
  assert.equal(loaded.EMAIL_SMTP_USERNAME, "resend");
  assert.equal(loaded.EMAIL_SMTP_PASSWORD, "test-smtp-password");
  assert.equal(loaded.EMAIL_FROM, "noreply@example.test");
  assert.equal(loaded.REMOTE_TICKET_PRIVATE_JWK === rotatedJwk, true);
  assert.equal(loaded.CLOUDFLARE_ACCOUNT_ID, undefined);
  assert.equal(loaded.DOTENV_PRIVATE_KEY_DEV, undefined);

  const deploySource = readFileSync(join(ROOT, "scripts/deploy-omar-auth-api.ts"), "utf8");
  assert.equal(deploySource.includes(".env.production"), false);
  assert.equal(deploySource.includes("dotenvx"), false);
  const config = readOmarWranglerConfig(readFileSync(join(ROOT, "apps/auth-api/wrangler.jsonc"), "utf8"));
  assertOmarDeploySafe(config);
  assert.equal(config.name, OMAR_WORKER_NAME);
  assert.equal(config.accountId, OMAR_ACCOUNT_ID);
  assert.deepEqual(
    config.r2Buckets,
    OMAR_R2_BUCKETS.map(([binding, name]) => [binding, name]),
  );
  assert.equal(config.databaseId, OMAR_PLACEHOLDER_DATABASE_ID);
  assert.throws(() => assertOmarDatabaseReady(config.databaseId), /placeholder id blocks/);

  report.passed = true;
  report.developmentCodeExposed = loaded.AUTH_EXPOSE_DEVELOPMENT_CODE === "true";
  report.smtpLoadedFromPrivateFile = loaded.EMAIL_SMTP_HOST === "smtp.example.test";
  report.accountIdKeptOutOfDevProcess = loaded.CLOUDFLARE_ACCOUNT_ID === undefined;
  report.ticketKeyAppendedWithoutPrinting = true;
  report.secondRunKeptTheSameKey = true;
  report.omarWorker = config.name;
  report.omarUsesWorkersDev = config.workersDev;
  report.omarRoutes = config.routes.length;
  report.omarR2Buckets = config.r2Buckets.map(([binding, name]) => `${binding}=${name}`).join(",");
  report.omarKvNamespaces = config.kvNamespaces.length;
  report.deployRefusesPlaceholderDatabase = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
  report.error = error;
} finally {
  rmSync(directory, { recursive: true, force: true });
  await import("node:fs/promises").then((fs) => fs.mkdir(OUT, { recursive: true }));
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${report.passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!report.passed) process.exitCode = 1;
}

function runTicketKeys(path: string, args: string[] = []): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [join(ROOT, "scripts/generate-remote-ticket-keys.ts"), ...args], {
      cwd: ROOT,
      env: { ...process.env, OPENBOT_BACKEND_ENV_FILE: path },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      const output = { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      if (code === 0) resolveRun(output);
      else rejectRun(new Error(output.stderr || `ticket key script exited ${code ?? 1}`));
    });
  });
}
