import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentEvent,
  TurnStepFile,
  TurnStepFileStatus,
  TurnStepKind,
  TurnStepStatus,
} from "@openbot/contracts/ipc";

/** The live step the chat draws, as the decoder holds it. */
type TurnStepEvent = Extract<AgentEvent, { type: "turn-step" }>;

import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { getArray, getRecord, getString, type ThreadItem } from "../protocol";
import { isToolItem, toolFailed, toolTraceDetail, toolUsage } from "./thread-items";

/** The item keys that can hold the paths a file-change step touched, in read order. */
const FILE_PATH_KEYS = ["filePaths", "filePath", "paths", "path"] as const;

/** The item keys that can hold a per-file added or removed line count. */
const COUNT_KEYS = ["additions", "deletions"] as const;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Whether the item is a step the Changes panel follows: a command, a file change or a subagent. */
export function classifyTurnStepKind(item: ThreadItem): TurnStepKind | null {
  if (item.type === "agentMessage") return "thought";
  if (!isToolItem(item)) return null;
  if (toolTraceDetail(item).recipientAgentIds) return "subagent";
  const kind = toolUsage(item)?.kind;
  if (kind === "command") return "command";
  if (kind === "file_change") return "file-change";
  if (kind === "subagent") return "subagent";
  return null;
}

/**
 * The keys of an ACP tool's raw input that name the file it writes. OpenCode sends `filePath`,
 * other agents `file_path` or `path`.
 */
const RAW_INPUT_PATH_KEYS = ["filePath", "file_path", "path"] as const;

/**
 * How one touched file changed, from the item's operation words and, for an ACP tool, its kind
 * and name (`delete`, `write`). Defaults to changed in place.
 */
function fileStatus(item: ThreadItem): TurnStepFileStatus {
  const operation = [
    getString(item, "operation"),
    getString(item, "action"),
    getString(item, "command"),
    getString(item, "toolKind"),
    getString(item, "name"),
  ]
    .filter(isString)
    .join(" ")
    .toLowerCase();
  if (/(delet|remov|unlink)/u.test(operation)) return "deleted";
  if (/(creat|add(?!\s*to)|new\b|write)/u.test(operation)) return "added";
  return "modified";
}

/** The raw input of an ACP tool, which a client may send as an object or as JSON text. */
function rawInput(item: ThreadItem) {
  let input: unknown = item.arguments;
  if (isString(input)) {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  return isDynamicRecord(input) ? input : null;
}

/** The paths in an ACP tool's raw input. */
function rawInputPaths(item: ThreadItem): unknown[] {
  const input = rawInput(item);
  return input ? RAW_INPUT_PATH_KEYS.map((key) => input[key]) : [];
}

/** The first text under any of `keys`, or null. The empty string counts: it is an emptied file. */
function firstText(input: NonNullable<ReturnType<typeof rawInput>>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (isString(value)) return value;
  }
  return null;
}

function textLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * What the tool input says about the change: its added and removed line counts and a unified diff,
 * redacted as a command is. A write has the new text (`content`); an edit has the old and the new
 * text. A tool whose input has neither keeps no diff. The diff is cut to the per-file limit, and
 * the counts keep the whole change.
 */
function inputChange(
  item: ThreadItem,
  path: string,
  status: TurnStepFileStatus,
): { additions: number; deletions: number; diff: string } | null {
  const input = rawInput(item);
  if (!input) return null;
  const oldText = firstText(input, ["oldString", "old_string"]);
  const newText = firstText(input, ["newString", "new_string", "content"]);
  if (oldText === null && newText === null) return null;
  const removed = oldText === null ? [] : textLines(oldText);
  const added = newText === null || status === "deleted" ? [] : textLines(newText);
  const name = path.split(/[\\/]/u).pop() || path;
  const lines = [
    `--- ${removed.length === 0 && status === "added" ? "/dev/null" : `a/${name}`}`,
    `+++ b/${name}`,
    `@@ -${removed.length === 0 ? 0 : 1},${removed.length} +${added.length === 0 ? 0 : 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ];
  const diff = redactText(lines.join("\n"));
  const cut = diff.length > INPUT_LIMITS.turnStepDiff;
  return {
    additions: added.length,
    deletions: removed.length,
    diff: cut ? `${diff.slice(0, INPUT_LIMITS.turnStepDiff - 2)}\n…` : diff,
  };
}

/**
 * The files an item touched, deduplicated, with counts when the item reports them. `locations` are
 * the paths that the provider client sent beside the item: an ACP tool reports its files there, and
 * an ACP tool that finishes may name none, so the raw input is read as well.
 */
export function turnStepFiles(item: ThreadItem, locations: readonly unknown[] = []): TurnStepFile[] {
  const status = fileStatus(item);
  const seen = new Set<string>();
  const files: TurnStepFile[] = [];
  const inputPath = rawInputPaths(item).find(isString)?.trim();
  const sources: unknown[][] = [
    [...locations],
    ...FILE_PATH_KEYS.map((key) => (key === "filePaths" || key === "paths" ? getArray(item, key) : [item[key]])),
    rawInputPaths(item),
  ];
  for (const raw of sources) {
    for (const candidate of raw) {
      if (!isString(candidate)) continue;
      const path = candidate.trim();
      if (!path || path.length > INPUT_LIMITS.path || seen.has(path)) continue;
      seen.add(path);
      const file: TurnStepFile = { path, status };
      for (const countKey of COUNT_KEYS) {
        const count = getRecord(item, "diffStats")?.[countKey] ?? item[countKey];
        if (isCount(count)) file[countKey] = Math.min(count, Number.MAX_SAFE_INTEGER);
      }
      // The tool input names one file: its text is the change of that file, or of the only file.
      const change = path === inputPath || inputPath === undefined ? inputChange(item, path, status) : null;
      if (change) {
        file.additions ??= change.additions;
        file.deletions ??= change.deletions;
        file.diff = change.diff;
      }
      files.push(file);
      if (files.length >= INPUT_LIMITS.turnStepFiles) return files;
    }
  }
  return files;
}

/**
 * How many files and how much diff text each turn has already reported, so one runaway turn cannot
 * flood the panel or the stored trace. A turn keeps at most `INPUT_LIMITS.turnStepFiles` files and
 * `INPUT_LIMITS.turnDiffBudget` characters of diff; a file past the diff budget keeps its row and
 * counts without the text. `drop` frees a turn when it ends.
 */
export class TurnStepFileBudget {
  readonly #used = new Map<string, number>();
  readonly #diffUsed = new Map<string, number>();

  take(turnId: string, files: TurnStepFile[]): TurnStepFile[] {
    const used = this.#used.get(turnId) ?? 0;
    const kept = files
      .slice(0, Math.max(0, INPUT_LIMITS.turnStepFiles - used))
      .map((file) => this.#fitDiff(turnId, file));
    if (kept.length > 0) this.#used.set(turnId, used + kept.length);
    return kept;
  }

  #fitDiff(turnId: string, file: TurnStepFile): TurnStepFile {
    if (file.diff === undefined) return file;
    const used = this.#diffUsed.get(turnId) ?? 0;
    if (used + file.diff.length <= INPUT_LIMITS.turnDiffBudget) {
      this.#diffUsed.set(turnId, used + file.diff.length);
      return file;
    }
    return {
      path: file.path,
      status: file.status,
      ...(file.additions === undefined ? {} : { additions: file.additions }),
      ...(file.deletions === undefined ? {} : { deletions: file.deletions }),
    };
  }

  drop(turnId: string): void {
    this.#used.delete(turnId);
    this.#diffUsed.delete(turnId);
  }

  clear(): void {
    this.#used.clear();
    this.#diffUsed.clear();
  }
}

/** The first line of a thought, without Markdown emphasis, as the row's name. */
function thoughtTitle(text: string): string {
  const line = text.trim().split("\n", 1)[0] ?? "";
  return line
    .replace(/^#+\s*/, "")
    .replaceAll("**", "")
    .slice(0, 120);
}

export interface TurnStepInput {
  agentId: string;
  threadId: string;
  turnId: string;
  item: ThreadItem;
  /** The host's progress words for the step, or null when it has none. */
  text: string | null;
  completed: boolean;
  startedAt: string;
  endedAt: string | null;
  files: TurnStepFile[];
}

/**
 * The `turn-step` event for an item, or null when the item is no live step. The command carries
 * the host's redaction, as the trace command does, because a command can hold a token.
 */
export function buildTurnStepEvent(input: TurnStepInput): AgentEvent | null {
  const { agentId, threadId, turnId, item, text, completed, startedAt, endedAt, files } = input;
  const kind: TurnStepKind | null = classifyTurnStepKind(item);
  if (!kind || !isString(item.id) || item.id.length === 0) return null;
  const failed = completed && (kind === "thought" ? false : toolFailed(item));
  const status: TurnStepStatus = completed ? (failed ? "failed" : "done") : "running";
  const rowText = kind === "thought" ? thoughtTitle(isString(item.text) ? item.text : "") : (text ?? "").trim();
  if (!rowText) return null;
  const event: TurnStepEvent = {
    type: "turn-step",
    agentId,
    threadId,
    turnId,
    stepId: item.id,
    kind,
    status,
    text: rowText.slice(0, INPUT_LIMITS.turnStepText),
    startedAt,
    ...(endedAt ? { endedAt } : {}),
  };
  if (kind === "command") {
    const command = toolTraceDetail(item).command?.trim();
    if (command) event.command = redactText(command).slice(0, INPUT_LIMITS.turnStepCommand);
    const exitCode = item.exitCode;
    if (typeof exitCode === "number" && Number.isSafeInteger(exitCode)) event.exitCode = exitCode;
  }
  if (kind === "file-change" && files.length > 0) event.files = files;
  if (kind === "subagent") {
    const recipients = toolTraceDetail(item).recipientAgentIds;
    if (recipients)
      event.text = `${rowText} → ${recipients.join(", ").slice(0, 400)}`.slice(0, INPUT_LIMITS.turnStepText);
  }
  return event;
}
