import type { ActionRiskLevel, AgentApprovalKind } from "@openbot/contracts/ipc";

/**
 * How risky one action is, and the stable rule that gave the answer. The rule is a code for the
 * audit log and never shows as text, so a rule can be renamed without a catalog change.
 */
export interface ActionRisk {
  level: ActionRiskLevel;
  rule: string;
}

const RANK: Record<ActionRiskLevel, number> = { low: 0, medium: 1, high: 2 };

/** Programs that only read. A read of a path that is not in the workspace is still a read. */
const READ_PROGRAMS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "rg",
  "grep",
  "wc",
  "pwd",
  "echo",
  "printf",
  "which",
  "date",
  "true",
  "false",
  "cd",
  "file",
  "stat",
  "tree",
  "du",
  "df",
  "uname",
  "sort",
  "uniq",
  "cut",
  "tr",
  "diff",
  "realpath",
  "basename",
  "dirname",
  "test",
]);

/** Test runners. Their scripts can run any code, but the person names a test run and no more. */
const TEST_PROGRAMS = new Set(["vitest", "jest", "pytest"]);

/** Command-line tools that change a deployed system, its data or its secrets. */
const INFRA_PROGRAMS = new Set([
  "wrangler",
  "vercel",
  "netlify",
  "fly",
  "flyctl",
  "railway",
  "heroku",
  "kubectl",
  "helm",
  "terraform",
  "pulumi",
  "aws",
  "gcloud",
  "az",
  "supabase",
  "docker",
  "podman",
  "prisma",
  "drizzle-kit",
  "dotenvx",
  "security",
  "openssl",
]);

/** Command-line tools that run SQL. A read statement is low risk; any other statement is high. */
const SQL_PROGRAMS = new Set(["psql", "mysql", "sqlite3"]);

const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);
const RUNNERS = new Set(["npx", "bunx"]);
const CODE_PROGRAMS = new Set(["node", "python", "python3", "ruby", "perl", "deno", "tsx", "ts-node", "make", "go"]);
const SHELLS = new Set(["sh", "bash", "zsh"]);

/** Branches whose push changes the release line. A push here is high risk. */
const DEFAULT_BRANCHES = new Set(["main", "master", "trunk", "develop", "release", "production"]);
/** The prefix of the branches OpenBot makes for work threads. A push to one is the agent's own. */
const OWN_BRANCH_PREFIX = "openbot/";

/** Words in a script name that mark a script that changes data, releases or secrets. */
const DANGEROUS_SCRIPT = /migrat|deploy|publish|release|secret|seed|reset|drop|wipe|purge|delete|destroy|prod/i;
const MIGRATION_WORD = /\bmigrat(e|ion|ions|ing)\b/i;
const SQL_WRITE = /\b(drop|truncate|delete|alter|update|insert|create|grant|revoke)\b/i;
const FORCE_FLAG = /^(-f|--force|--force-with-lease|--force-if-includes|--delete|-d|--mirror|--prune)$|^--force/;

const risk = (level: ActionRiskLevel, rule: string): ActionRisk => ({ level, rule });

function higher(a: ActionRisk, b: ActionRisk): ActionRisk {
  return RANK[b.level] > RANK[a.level] ? b : a;
}

/**
 * The risk of one approval request. Permission changes and file changes do not run a command, so
 * they have fixed levels. A command with no text, or one this classifier does not know, is high.
 */
export function classifyApprovalRisk(approval: { kind: AgentApprovalKind; command: string | null }): ActionRisk {
  if (approval.kind === "permissions") return risk("high", "permissions.widen");
  if (approval.kind === "file-change") return risk("medium", "file.change");
  const command = approval.command === null ? "" : approvalCommandLine(approval.command);
  if (command.trim() === "") return risk("high", "command.unknown");
  return classifyCommand(command, 0);
}

/**
 * The command line of an approval. An ACP agent such as OpenCode sends its tool input as an object,
 * `{"command":"git status","cwd":...}`, which reaches the gate as JSON text. Read as a command line,
 * that text is an unknown program, so every OpenCode command would be high risk and ask. The same
 * line is what the approval card and the audit log show, so the person reads `git status` and not
 * the JSON. Text that is not such an object is returned as it is.
 */
export function approvalCommandLine(command: string): string {
  const trimmed = command.trim();
  if (!trimmed.startsWith("{")) return command;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return command;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return command;
  const value = "command" in parsed ? parsed.command : "cmd" in parsed ? parsed.cmd : undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value.join(" ");
  return command;
}

/**
 * The risk of a shell command. It is split at `&&`, `||`, `;`, `|` and new lines, and the riskiest
 * part decides. Command substitution cannot be read statically, so it is high. `sh -c` runs its
 * text again, up to two levels deep.
 */
function classifyCommand(command: string, depth: number): ActionRisk {
  if (depth > 2) return risk("high", "command.nested");
  const nested = /^\s*(?:sh|bash|zsh)\s+-c\s+(['"])([\s\S]*)\1\s*$/.exec(command);
  if (nested?.[2] !== undefined) return classifyCommand(nested[2], depth + 1);
  if (/\$\(|`/.test(command)) return risk("high", "command.substitution");
  if (MIGRATION_WORD.test(command) && !/^\s*(?:ls|cat|head|tail|rg|grep)\b/.test(command))
    return risk("high", "data.migrate");

  let worst: ActionRisk | null = null;
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const trimmed = segment.trim();
    if (trimmed === "") continue;
    const current = classifySegment(trimmed, depth);
    worst = worst === null ? current : higher(worst, current);
  }
  return worst ?? risk("low", "command.empty");
}

function classifySegment(segment: string, depth: number): ActionRisk {
  const tokens = segment.split(/\s+/).map((token) => token.replace(/^(['"])(.*)\1$/, "$2"));
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? "")) tokens.shift();
  const first = tokens[0];
  if (first === undefined) return risk("low", "command.empty");
  const program = (first.split("/").at(-1) ?? first).toLowerCase();
  if (program === "sudo" || program === "doas") return risk("high", "privilege.elevated");
  const base = classifyProgram(program, tokens.slice(1), depth);
  // A redirect to a file writes data, so a read with one is a change.
  const writesFile = /(^|[^\d&])>(?!&|\s*\/dev\/null)/.test(segment);
  return writesFile && base.level === "low" ? risk("medium", "shell.redirect") : base;
}

function classifyProgram(program: string, args: string[], depth: number): ActionRisk {
  if (READ_PROGRAMS.has(program)) {
    if (program === "sed" && args.some((arg) => arg === "-i" || arg.startsWith("-i")))
      return risk("medium", "file.edit");
    return risk("low", "read");
  }
  if (program === "find") {
    if (args.some((arg) => arg === "-delete")) return risk("high", "delete");
    if (args.some((arg) => /^-(exec|execdir|ok|okdir)$/.test(arg))) return risk("high", "command.unknown");
    return risk("low", "read");
  }
  if (TEST_PROGRAMS.has(program)) return risk("low", "test.run");
  if (program === "git") return classifyGit(args);
  if (program === "gh") return classifyGh(args);
  if (PACKAGE_MANAGERS.has(program)) return classifyPackageManager(args, depth);
  if (RUNNERS.has(program)) {
    const [tool, ...rest] = args;
    if (tool === undefined) return risk("medium", "tool.run");
    // `npx vitest run` is a test run and `npx wrangler deploy` is a deploy: the tool decides.
    return classifyProgram(tool.toLowerCase(), rest, depth);
  }
  if (INFRA_PROGRAMS.has(program)) {
    if (args.some((arg) => arg === "--version" || arg === "-v" || arg === "version" || arg === "--help"))
      return risk("low", "read");
    if (program === "security" || program === "openssl" || program === "dotenvx") return risk("high", "secrets.change");
    return risk("high", "deploy.infra");
  }
  if (SQL_PROGRAMS.has(program)) {
    const text = args.join(" ");
    if (SQL_WRITE.test(text) || !/\bselect\b/i.test(text)) return risk("high", "sql.write");
    return risk("low", "sql.read");
  }
  if (program === "rm" || program === "rmdir" || program === "unlink" || program === "shred")
    return risk("high", "delete");
  if (program === "dd" || program === "mkfs" || program.startsWith("mkfs.")) return risk("high", "disk.write");
  if (program === "mv" || program === "cp" || program === "mkdir" || program === "touch" || program === "ln")
    return risk("medium", "file.change");
  if (program === "chmod" || program === "chown") return risk("medium", "file.permissions");
  if (program === "curl" || program === "wget") {
    const writes = args.some((arg) =>
      /^(-X|--request)$/.test(arg) ? true : /^(-d|--data|-F|--form|-T|--upload-file)/.test(arg),
    );
    return writes ? risk("high", "network.write") : risk("medium", "network.fetch");
  }
  if (program === "cargo") {
    const sub = args[0];
    if (sub === "test" || sub === "check" || sub === "clippy") return risk("low", "test.run");
    if (sub === "run" || sub === "install" || sub === "add" || sub === "build") return risk("medium", "code.run");
    return risk("high", "command.unknown");
  }
  if (CODE_PROGRAMS.has(program)) {
    if (program === "make" && (args[0] === "test" || args[0] === "check")) return risk("low", "test.run");
    if (args.every((arg) => arg === "--version" || arg === "-v" || arg === "version")) return risk("low", "read");
    return risk("medium", "code.run");
  }
  if (SHELLS.has(program)) return risk("high", "shell.stdin");
  return risk("high", "command.unknown");
}

function classifyPackageManager(args: string[], depth: number): ActionRisk {
  const sub = args[0];
  if (sub === undefined) return risk("medium", "script.run");
  if (sub === "install" || sub === "i" || sub === "add" || sub === "ci") return risk("medium", "deps.install");
  if (sub === "publish") return risk("high", "package.publish");
  if (sub === "test" || sub === "t") return risk("low", "test.run");
  if (sub === "run" || sub === "run-script") {
    const name = args[1] ?? "";
    if (DANGEROUS_SCRIPT.test(name)) return risk("high", "script.dangerous");
    if (/^(test|typecheck)(:|$)/.test(name)) return risk("low", "test.run");
    return risk("medium", "script.run");
  }
  if (sub === "exec" || sub === "dlx") return classifyProgram((args[1] ?? "").toLowerCase(), args.slice(2), depth);
  if (/\.(c|m)?[jt]sx?$/.test(sub)) return risk("medium", "code.run");
  return risk("medium", "tool.run");
}

function classifyGit(args: string[]): ActionRisk {
  // Skip the options that come before the subcommand: `-C <path>` and `-c <key=value>`.
  let index = 0;
  while (index < args.length && (args[index] === "-C" || args[index] === "-c")) index += 2;
  const sub = args[index] ?? "";
  const rest = args.slice(index + 1);
  switch (sub) {
    case "status":
    case "diff":
    case "log":
    case "show":
    case "rev-parse":
    case "ls-files":
    case "blame":
    case "grep":
    case "describe":
    case "shortlog":
    case "cat-file":
    case "ls-remote":
    case "rev-list":
    case "fetch":
      return risk("low", "git.read");
    case "branch":
      if (rest.some((arg) => /^(-d|-D|--delete|-m|-M|--move)$/.test(arg))) return risk("high", "git.branch.delete");
      return rest.some((arg) => !arg.startsWith("-")) ? risk("low", "git.branch.create") : risk("low", "git.read");
    case "checkout": {
      if (rest.some((arg) => arg === "-b" || arg === "-B")) return risk("low", "git.branch.create");
      if (rest.includes("--") || rest.includes(".")) return risk("high", "git.discard");
      return risk("medium", "git.switch");
    }
    case "switch":
      return rest.some((arg) => arg === "-c" || arg === "-C" || arg === "--create")
        ? risk("low", "git.branch.create")
        : risk("medium", "git.switch");
    case "restore":
      return rest.includes("--staged") ? risk("medium", "git.stage") : risk("high", "git.discard");
    case "reset":
      return rest.includes("--hard") ? risk("high", "git.discard") : risk("medium", "git.reset");
    case "clean":
    case "gc":
    case "prune":
      return risk("high", "git.discard");
    case "stash":
      return rest[0] === "drop" || rest[0] === "clear" ? risk("high", "git.discard") : risk("medium", "git.stash");
    case "add":
    case "commit":
    case "rebase":
    case "cherry-pick":
    case "revert":
    case "pull":
    case "config":
    case "tag":
      return sub === "tag" && rest.some((arg) => arg === "-d" || arg === "--delete")
        ? risk("high", "git.delete")
        : risk("medium", `git.${sub}`);
    case "rm":
    case "mv":
      return risk("high", "git.delete");
    case "merge":
      return risk("high", "git.merge");
    case "remote":
      return rest.length === 0 || rest[0] === "-v" || rest[0] === "get-url"
        ? risk("low", "git.read")
        : risk("medium", "git.remote.change");
    case "worktree":
      if (rest[0] === "list") return risk("low", "git.read");
      if (rest[0] === "remove" || rest[0] === "prune") return risk("high", "git.delete");
      return risk("medium", "git.worktree");
    case "push":
      return classifyPush(rest);
    default:
      return risk("high", "git.unknown");
  }
}

function classifyPush(args: string[]): ActionRisk {
  if (args.some((arg) => FORCE_FLAG.test(arg))) return risk("high", "git.push.forced");
  const refspecs = args.filter((arg) => !arg.startsWith("-")).slice(1);
  if (refspecs.length === 0) return risk("medium", "git.push.unknown-branch");
  let worst = risk("low", "git.push.own");
  for (const refspec of refspecs) {
    if (refspec.startsWith("+")) return risk("high", "git.push.forced");
    const [source = "", destination] = refspec.split(":");
    const target = (destination === undefined ? source : destination).replace(/^refs\/heads\//, "");
    if (target === "") return risk("high", "git.push.delete");
    if (DEFAULT_BRANCHES.has(target)) return risk("high", "git.push.default");
    if (target === "HEAD" && destination === undefined)
      worst = higher(worst, risk("medium", "git.push.unknown-branch"));
    else if (!target.startsWith(OWN_BRANCH_PREFIX)) worst = higher(worst, risk("medium", "git.push.other"));
  }
  return worst;
}

function classifyGh(args: string[]): ActionRisk {
  const words = args.filter((arg) => !arg.startsWith("-"));
  const [group = "", sub = ""] = words;
  if (group === "api") {
    const method = args.findIndex((arg) => arg === "-X" || arg === "--method");
    const writes =
      (method >= 0 && (args[method + 1] ?? "GET").toUpperCase() !== "GET") ||
      args.some((arg) => /^(-f|-F|--field|--raw-field|--input)/.test(arg));
    return writes ? risk("high", "gh.api.write") : risk("low", "gh.read");
  }
  if (["view", "list", "diff", "checks", "status", "search", "watch"].includes(sub) && group !== "auth")
    return risk("low", "gh.read");
  if (group === "pr") {
    if (sub === "merge") return risk("high", "gh.merge");
    if (["create", "comment", "review", "edit", "ready", "close", "reopen"].includes(sub))
      return risk("medium", "gh.pr.write");
  }
  if (group === "issue") {
    if (sub === "delete" || sub === "transfer") return risk("high", "gh.delete");
    if (["create", "comment", "edit", "close", "reopen"].includes(sub)) return risk("medium", "gh.issue.write");
  }
  return risk("high", "gh.admin");
}
