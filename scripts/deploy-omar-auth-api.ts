import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { privateBackendEnvPath, readPrivateBackendEnv } from "./private-backend-env";

const logger = createOpenBotLogger("deploy-omar-auth-api");

/** The Cloudflare account this deploy is allowed to use. It is not a secret. */
export const OMAR_ACCOUNT_ID = "f77ab81c787067b7c3ce1632449bfd68";
export const OMAR_WORKER_NAME = "account";
export const OMAR_ACCOUNT_ORIGIN = "https://account.omarghorabdev.workers.dev";
export const OMAR_DATABASE_NAME = "openbot-auth-omar";
export const OMAR_PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
export const FORBIDDEN_WORKER_NAME = "randomchat-deadman";

export const OMAR_SECRET_NAMES = [
  "EMAIL_SMTP_HOST",
  "EMAIL_SMTP_PORT",
  "EMAIL_SMTP_USERNAME",
  "EMAIL_SMTP_PASSWORD",
  "EMAIL_FROM",
  "SKILLS_ADMIN_TOKEN",
  "SITE_REPORT_HASH_SECRET",
  "REMOTE_TICKET_PRIVATE_JWK",
  "REMOTE_TICKET_PUBLIC_JWKS",
  "REMOTE_AUTH_WEBHOOK_SECRET",
  "SERVER_CLAIMS_ADMIN_TOKEN",
] as const;

export const OMAR_R2_BUCKETS = [
  ["AVATARS", "openbot-omar-avatars"],
  ["SKILLS", "openbot-omar-skills"],
  ["SITES", "openbot-omar-sites"],
] as const;

export const OMAR_RATE_LIMITS = [
  ["MARKETPLACE_INGRESS_RATE_LIMITER", "2026102501"],
  ["MARKETPLACE_MUTATION_RATE_LIMITER", "2026102502"],
  ["MARKETPLACE_UPLOAD_RATE_LIMITER", "2026102503"],
  ["SITE_REPORT_RATE_LIMITER", "2026102504"],
  ["GITHUB_TOKEN_RATE_LIMITER", "2026102505"],
  ["LIVE_ACTIVITY_RATE_LIMITER", "2026102506"],
] as const;

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsRoot, "..");
const apiRoot = join(projectRoot, "apps", "auth-api");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const wranglerExecutable = join(projectRoot, "node_modules", ".bin", `wrangler${executableSuffix}`);

interface OmarWranglerConfig {
  name: string;
  accountId: string;
  databaseId: string;
  workersDev: boolean;
  routes: unknown[];
  r2Buckets: Array<[string, string]>;
  kvNamespaces: unknown[];
  hostedServersEnabled: string;
  exposeDevelopmentCode: string;
  rateLimits: Array<[string, string]>;
}

/** Removes `//` comments that are outside strings, so the Wrangler file can be parsed as JSON. */
export function stripJsonComments(text: string): string {
  let output = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      continue;
    }
    if (character === "/" && text[index + 1] === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    output += character;
  }
  return output;
}

function asRecord(value: unknown) {
  return isDynamicRecord(value) ? value : undefined;
}

function textField(record: ReturnType<typeof asRecord>, key: string): string {
  if (!record) return "";
  const value = record[key];
  return isString(value) ? value : "";
}

function stringPair(entry: unknown): [string, string] | undefined {
  const record = asRecord(entry);
  if (!record || !isString(record.name) || !isString(record.namespace_id)) return undefined;
  return [record.name, record.namespace_id];
}

function bucketPair(entry: unknown): [string, string] | undefined {
  const record = asRecord(entry);
  if (!record || !isString(record.binding) || !isString(record.bucket_name)) return undefined;
  return [record.binding, record.bucket_name];
}

export function readOmarWranglerConfig(text: string): OmarWranglerConfig {
  const parsed = asRecord(JSON.parse(stripJsonComments(text)));
  const env = asRecord(parsed?.env);
  const omar = asRecord(env?.omar);
  if (!omar) throw new Error("The Wrangler config has no omar environment.");
  const databases = omar.d1_databases;
  const database = asRecord(Array.isArray(databases) ? databases[0] : undefined);
  const vars = asRecord(omar.vars);
  const rateLimits = Array.isArray(omar.ratelimits)
    ? omar.ratelimits.flatMap((entry) => {
        const pair = stringPair(entry);
        return pair ? [pair] : [];
      })
    : [];
  return {
    name: textField(omar, "name"),
    accountId: textField(omar, "account_id"),
    databaseId: textField(database, "database_id"),
    workersDev: omar.workers_dev === true,
    routes: Array.isArray(omar.routes) ? omar.routes : ["missing"],
    r2Buckets: Array.isArray(omar.r2_buckets)
      ? omar.r2_buckets.flatMap((entry) => {
          const pair = bucketPair(entry);
          return pair ? [pair] : [];
        })
      : [],
    kvNamespaces: Array.isArray(omar.kv_namespaces) ? omar.kv_namespaces : ["missing"],
    hostedServersEnabled: textField(vars, "HOSTED_SERVERS_ENABLED"),
    exposeDevelopmentCode: textField(vars, "AUTH_EXPOSE_DEVELOPMENT_CODE"),
    rateLimits,
  };
}

/** Rejects a config that could touch another Worker, a custom domain, or the wrong bucket. */
export function assertOmarDeploySafe(config: OmarWranglerConfig): void {
  if (config.name === FORBIDDEN_WORKER_NAME) throw new Error("Refusing to deploy randomchat-deadman.");
  if (config.name !== OMAR_WORKER_NAME) {
    throw new Error(`The omar Worker name must be ${OMAR_WORKER_NAME}.`);
  }
  if (config.accountId !== OMAR_ACCOUNT_ID) throw new Error("The omar environment account id does not match.");
  if (!config.workersDev) throw new Error("The omar environment must use workers.dev.");
  if (config.routes.length !== 0) throw new Error("The omar environment must not set a route or a custom domain.");
  const expectedBuckets = OMAR_R2_BUCKETS.map(([binding, name]) => `${binding}:${name}`).join(",");
  const actualBuckets = config.r2Buckets.map(([binding, name]) => `${binding}:${name}`).join(",");
  if (actualBuckets !== expectedBuckets) {
    throw new Error("The omar environment must bind AVATARS, SKILLS, and SITES to the openbot-omar buckets.");
  }
  if (config.kvNamespaces.length !== 0) throw new Error("The omar environment must not bind KV.");
  if (config.hostedServersEnabled !== "false") throw new Error("Hosted servers must stay off in the omar environment.");
  if (config.exposeDevelopmentCode !== "false") {
    throw new Error("The omar environment must not return development sign-in codes.");
  }
  const expected = OMAR_RATE_LIMITS.map(([name, id]) => `${name}:${id}`).join(",");
  const actual = config.rateLimits.map(([name, id]) => `${name}:${id}`).join(",");
  if (actual !== expected) throw new Error("The omar rate-limit namespaces do not match the documented list.");
}

export function assertOmarDatabaseReady(databaseId: string): void {
  if (databaseId === OMAR_PLACEHOLDER_DATABASE_ID || !/^[0-9a-f-]{36}$/u.test(databaseId)) {
    throw new Error(
      `Create the D1 database ${OMAR_DATABASE_NAME}, then paste its id into apps/auth-api/wrangler.jsonc under env.omar. The placeholder id blocks this command.`,
    );
  }
}

function secretValues(environment: Record<string, string>): Record<string, string> {
  const missing = OMAR_SECRET_NAMES.filter(
    (name) => !environment[name]?.trim() || environment[name]?.startsWith("encrypted:"),
  );
  if (missing.length > 0) throw new Error(`Missing private settings: ${missing.join(", ")}.`);
  return Object.fromEntries(OMAR_SECRET_NAMES.map((name) => [name, environment[name] ?? ""]));
}

async function main(): Promise<void> {
  const migrateOnly = process.argv.includes("--migrate-only");
  if (process.argv.slice(2).some((argument) => argument !== "--migrate-only")) {
    throw new Error("Use bun run api:deploy:omar, or bun run api:migrate:omar.");
  }
  const config = readOmarWranglerConfig(readFileSync(join(apiRoot, "wrangler.jsonc"), "utf8"));
  assertOmarDeploySafe(config);
  assertOmarDatabaseReady(config.databaseId);
  const path = privateBackendEnvPath();
  const loaded = readPrivateBackendEnv({ ...process.env, OPENBOT_BACKEND_ENV_FILE: path });
  if (loaded.CLOUDFLARE_ACCOUNT_ID?.trim() !== OMAR_ACCOUNT_ID) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID in the private environment file does not match the omar account.");
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: OMAR_ACCOUNT_ID,
  };
  delete environment.CLOUDFLARE_API_TOKEN;
  if (loaded.CLOUDFLARE_API_TOKEN?.trim()) environment.CLOUDFLARE_API_TOKEN = loaded.CLOUDFLARE_API_TOKEN;
  if (!migrateOnly) {
    const secrets = secretValues(loaded);
    for (const name of OMAR_SECRET_NAMES) {
      await run(wranglerExecutable, ["secret", "put", name, "--env", "omar"], {
        input: `${secrets[name]}\n`,
        label: `${name} secret`,
        env: environment,
      });
    }
  }
  await run(wranglerExecutable, ["d1", "migrations", "apply", "DB", "--remote", "--env", "omar"], {
    label: "Remote D1 migrations",
    env: environment,
  });
  if (migrateOnly) return;
  await run(process.execPath, ["run", "build"], {
    label: "Auth API build",
    env: buildEnvironment(environment, loaded),
  });
  await run(wranglerExecutable, ["deploy", "--keep-vars", "--env", "omar"], {
    label: "Auth API deployment",
    env: { ...environment, CLOUDFLARE_ENV: "omar" },
  });
}

function buildEnvironment(environment: NodeJS.ProcessEnv, loaded: Record<string, string>): NodeJS.ProcessEnv {
  const build: NodeJS.ProcessEnv = { ...environment, CLOUDFLARE_ENV: "omar" };
  for (const [name, value] of Object.entries(loaded)) {
    if (name.startsWith("OPENBOT_") && value.trim()) build[name] = value;
  }
  if (!build.OPENBOT_ACCOUNT_URL?.trim()) build.OPENBOT_ACCOUNT_URL = OMAR_ACCOUNT_ORIGIN;
  return build;
}

async function run(
  executable: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; input?: string; label: string },
): Promise<void> {
  await new Promise<void>((resolveProcess, rejectProcess) => {
    const child = spawn(executable, args, {
      cwd: apiRoot,
      env: options.env,
      shell: false,
      stdio: [options.input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    });
    child.once("error", rejectProcess);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveProcess();
      else {
        rejectProcess(new Error(`${options.label} failed with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}.`));
      }
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

if (import.meta.main) {
  void main().catch((error) => {
    logger.error("Omar account deployment failed.", toLogValue(error));
    process.exitCode = 1;
  });
}
