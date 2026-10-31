/**
 * Plan only (ticket 265): an agent that only reads and plans. OpenBot refuses its file edits and the
 * commands that could change files or git, also when the agent has Full access. A command passes only
 * when every part of it is a known read: an unknown command is refused, never guessed at.
 */

/** Commands that read and never write. */
const READ_COMMANDS = new Set([
  "cat",
  "cd",
  "echo",
  "file",
  "find",
  "grep",
  "head",
  "less",
  "ls",
  "pwd",
  "rg",
  "stat",
  "tail",
  "tree",
  "wc",
  "which",
]);

/** Git subcommands that read and never write. */
const READ_GIT = new Set([
  "blame",
  "branch",
  "diff",
  "grep",
  "log",
  "ls-files",
  "remote",
  "rev-parse",
  "show",
  "status",
]);

/** Flags that make a listing git subcommand write: a new, moved or deleted branch or remote. */
const GIT_WRITE_FLAGS = /(^|\s)(-[dDmMcC]|--delete|--move|--copy|add|remove|rename|set-url)(\s|$)/u;

/** `find` flags that delete or run another command. */
const FIND_WRITE_FLAGS = /(^|\s)(-delete|-exec|-execdir|-ok|-okdir|-fprint\S*|-fls)(\s|$)/u;

function isReadPart(part: string): boolean {
  const words = part.trim().split(/\s+/u).filter(Boolean);
  const [command, sub] = words;
  if (!command) return true;
  if (command === "git") {
    if (!sub || !READ_GIT.has(sub)) return false;
    return !GIT_WRITE_FLAGS.test(words.slice(2).join(" "));
  }
  if (command === "find") return !FIND_WRITE_FLAGS.test(words.slice(1).join(" "));
  return READ_COMMANDS.has(command);
}

/** Whether a command line only reads. A redirect into a file, `tee` or a subshell counts as a write. */
export function isReadOnlyCommand(command: string): boolean {
  const line = command.trim();
  if (line === "") return false;
  if (/[`]|\$\(|(^|[^0-9&])>|>>|<\(/u.test(line.replace(/2>&1|>\s*\/dev\/null/gu, ""))) return false;
  return line.split(/&&|\|\||;|\||\n/u).every(isReadPart);
}

/** Whether a plan-only agent's approval request is refused: every edit, grant, and any command that is not a read. */
export function planOnlyRefuses(approval: { kind: "command" | "file-change" | "permissions"; command: string | null }) {
  if (approval.kind !== "command") return true;
  return approval.command === null || !isReadOnlyCommand(approval.command);
}

/** The reason that a refused agent reads. */
export const PLAN_ONLY_REFUSAL =
  "Refused: this agent is set to Plan only. It can read and post a plan, but cannot edit files or run commands that change files or git.";
