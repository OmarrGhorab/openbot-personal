import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** The private account file outside the repository. Override it with `OPENBOT_BACKEND_ENV_FILE`. */
export const DEFAULT_PRIVATE_BACKEND_ENV_PATH = join(homedir(), ".openbot-backend.env");

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * The path of the private account file. A set `OPENBOT_BACKEND_ENV_FILE` wins. A relative path is
 * resolved from the current directory. The default file is in the home directory, outside the repo.
 */
export function privateBackendEnvPath(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.OPENBOT_BACKEND_ENV_FILE?.trim();
  if (!configured) return DEFAULT_PRIVATE_BACKEND_ENV_PATH;
  if (configured.includes("\0")) throw new Error("OPENBOT_BACKEND_ENV_FILE is invalid.");
  return isAbsolute(configured) ? configured : resolve(configured);
}

/**
 * Reads the private account file. A missing default file yields an empty record, so local
 * development still starts. A set path that is missing is an error. The file must be a regular
 * file that other users cannot read.
 */
export function readPrivateBackendEnv(environment: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const configured = Boolean(environment.OPENBOT_BACKEND_ENV_FILE?.trim());
  const path = privateBackendEnvPath(environment);
  if (!existsSync(path)) {
    if (configured) throw new Error("OPENBOT_BACKEND_ENV_FILE does not point to a file.");
    return {};
  }
  assertPrivateEnvFile(path);
  return parsePrivateBackendEnv(readFileSync(path, "utf8"));
}

/** Parses `KEY=VALUE` lines. Comments and blank lines are ignored. The last copy of a key wins. */
export function parsePrivateBackendEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = body.indexOf("=");
    if (separator <= 0) throw new Error(`Private environment file line ${index + 1} is invalid.`);
    const name = body.slice(0, separator).trim();
    if (!ENV_NAME.test(name)) throw new Error(`Private environment file line ${index + 1} is invalid.`);
    values[name] = unquoteEnvValue(body.slice(separator + 1).trim(), index + 1);
  }
  return values;
}

export interface PrivateEnvWriteResult {
  /** Keys this write added. */
  added: string[];
  /** Keys that were already set and were left unchanged. */
  kept: string[];
  /** Keys whose previous value was replaced. */
  replaced: string[];
}

/**
 * Adds or replaces keys in the private file. Existing lines keep their place. New keys are appended.
 * The file mode is `600`. This function does not return the values.
 */
export function writePrivateBackendEnv(
  path: string,
  updates: Record<string, string>,
  options: { replace?: boolean } = {},
): PrivateEnvWriteResult {
  if (existsSync(path)) assertPrivateEnvFile(path);
  else if (existsSync(dirname(path)) && !lstatSync(dirname(path)).isDirectory()) {
    throw new Error("The private environment file directory is not a directory.");
  }
  const currentText = existsSync(path) ? readFileSync(path, "utf8") : "";
  const current = currentText ? parsePrivateBackendEnv(currentText) : {};
  const replace = options.replace === true;
  const added: string[] = [];
  const kept: string[] = [];
  const replaced: string[] = [];
  const pending: Record<string, string> = {};
  for (const [name, value] of Object.entries(updates)) {
    if (!ENV_NAME.test(name)) throw new Error("A private environment name is invalid.");
    if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
      throw new Error("A private environment value cannot contain a line break.");
    }
    if (Object.hasOwn(current, name) && !replace) {
      kept.push(name);
      continue;
    }
    pending[name] = value;
    if (Object.hasOwn(current, name)) replaced.push(name);
    else added.push(name);
  }
  if (added.length === 0 && replaced.length === 0) return { added, kept, replaced };
  const next = applyEnvUpdates(currentText, pending);
  publishPrivateEnvFile(path, next);
  return { added, kept, replaced };
}

function applyEnvUpdates(text: string, updates: Record<string, string>): string {
  const pending = new Set(Object.keys(updates));
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const next = lines.map((line) => {
    const match = /^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=)(.*)$/u.exec(line);
    const name = match?.[2];
    if (!name || !pending.has(name)) return line;
    pending.delete(name);
    return `${match[1]}${quoteEnvValue(updates[name] ?? "")}`;
  });
  for (const name of pending) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    next.push(`${name}=${quoteEnvValue(updates[name] ?? "")}`);
  }
  let body = next.join("\n");
  if (!body.endsWith("\n")) body = `${body}\n`;
  return body;
}

function quoteEnvValue(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function unquoteEnvValue(value: string, line: number): string {
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error(`Private environment file line ${line} is invalid.`);
    return value.slice(1, -1);
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new Error(`Private environment file line ${line} is invalid.`);
    return value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  if (value.includes(" #")) return value.slice(0, value.indexOf(" #")).trim();
  return value;
}

function assertPrivateEnvFile(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("The private environment file must be a regular file.");
  }
  if ((stat.mode & 0o077) !== 0) chmodSync(path, 0o600);
}

function publishPrivateEnvFile(path: string, contents: string): void {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporary, 0o600);
  try {
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}
