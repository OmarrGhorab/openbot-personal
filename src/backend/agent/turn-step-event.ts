import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentEvent,
  type TurnStepFile,
  type TurnStepFileStatus,
  type TurnStepKind,
  type TurnStepStatus,
} from "@openbot/contracts/ipc";
/** The live step the chat draws, as the decoder holds it. */
export type TurnStepEvent = Extract<AgentEvent, { type: "turn-step" }>;
import { isString } from "@openbot/contracts/runtime-values";
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

/** How one touched file changed, from the item's operation words. Defaults to changed in place. */
function fileStatus(item: ThreadItem): TurnStepFileStatus {
  const operation = [getString(item, "operation"), getString(item, "action"), getString(item, "command")]
    .filter(isString)
    .join(" ")
    .toLowerCase();
  if (/(delet|remov|unlink)/u.test(operation)) return "deleted";
  if (/(creat|add(?!\s*to)|new\b|write)/u.test(operation)) return "added";
  return "modified";
}

/** The files an item touched, deduplicated, with counts when the item reports them. */
export function turnStepFiles(item: ThreadItem): TurnStepFile[] {
  const status = fileStatus(item);
  const seen = new Set<string>();
  const files: TurnStepFile[] = [];
  for (const key of FILE_PATH_KEYS) {
    const raw = key === "filePaths" || key === "paths" ? getArray(item, key) : [item[key]];
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
      files.push(file);
      if (files.length >= INPUT_LIMITS.turnStepFiles) return files;
    }
  }
  return files;
}

/**
 * How many files each turn has already reported, so one runaway turn cannot flood the panel.
 * A turn keeps at most `INPUT_LIMITS.turnStepFiles` files; `drop` frees it when the turn ends.
 */
export class TurnStepFileBudget {
  readonly #used = new Map<string, number>();

  take(turnId: string, files: TurnStepFile[]): TurnStepFile[] {
    const used = this.#used.get(turnId) ?? 0;
    const kept = files.slice(0, Math.max(0, INPUT_LIMITS.turnStepFiles - used));
    if (kept.length > 0) this.#used.set(turnId, used + kept.length);
    return kept;
  }

  drop(turnId: string): void {
    this.#used.delete(turnId);
  }

  clear(): void {
    this.#used.clear();
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
  const rowText =
    kind === "thought" ? thoughtTitle(isString(item.text) ? item.text : "") : (text ?? "").trim();
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
    if (recipients) event.text = `${rowText} → ${recipients.join(", ").slice(0, 400)}`.slice(
      0,
      INPUT_LIMITS.turnStepText,
    );
  }
  return event;
}
