// The files a turn changed, as the Changes panel reads them. Local only: the Team API has no
// turn steps, so a joined server has no route for them.

import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

/** What the Changes panel asks for: the files of one turn, or of the whole thread without a turn. */
export interface TurnFilesInput {
  agentId: string;
  turnId?: string | undefined;
}

/** One file a turn changed, with its added and removed line counts when known. */
export interface TurnChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions?: number | undefined;
  deletions?: number | undefined;
}

const TURN_FILE_STATUSES = ["added", "modified", "deleted"] as const;

/** The files of a turn, in the order their steps changed them. */
export interface TurnFilesResult {
  agentId: string;
  /** Null for a conversation that has no thread yet. */
  threadId: string | null;
  /** Null when the input named no turn: the files of the whole thread. */
  turnId: string | null;
  files: TurnChangedFile[];
}

/** What the diff view asks for: one file of an agent's workspace, as the turn named it. */
export interface TurnFileDiffInput {
  agentId: string;
  path: string;
}

/** The working-tree diff of one file, and its current text for the File view. */
export interface TurnFileDiffResult {
  path: string;
  /** Empty when the file is not in a git checkout, or git could not read it. */
  diff: string;
  /** Absent when the file cannot be read as text. */
  content?: string | undefined;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isTurnChangedFile(value: unknown): value is TurnChangedFile {
  return (
    isDynamicRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    isBoundedString(value.path, INPUT_LIMITS.path) &&
    isOneOf(TURN_FILE_STATUSES, value.status) &&
    (value.additions === undefined || isCount(value.additions)) &&
    (value.deletions === undefined || isCount(value.deletions))
  );
}

export function isTurnFilesInput(value: unknown): value is TurnFilesInput {
  return (
    isDynamicRecord(value) && isIdentifier(value.agentId) && (value.turnId === undefined || isIdentifier(value.turnId))
  );
}

export function isTurnFilesResult(value: unknown): value is TurnFilesResult {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    (value.turnId === null || isIdentifier(value.turnId)) &&
    Array.isArray(value.files) &&
    value.files.length <= INPUT_LIMITS.turnStepFiles &&
    value.files.every(isTurnChangedFile)
  );
}

export function isTurnFileDiffInput(value: unknown): value is TurnFileDiffInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    isBoundedString(value.path, INPUT_LIMITS.path)
  );
}

/** The payload the Changes panel sends for the file list. Fails closed on a bad shape. */
export function parseTurnFilesInput(value: unknown): TurnFilesInput {
  if (!isTurnFilesInput(value)) throw new Error("Provide a valid agent and turn.");
  return value.turnId === undefined ? { agentId: value.agentId } : { agentId: value.agentId, turnId: value.turnId };
}

/** The payload the diff view sends for one file. Fails closed on a bad shape. */
export function parseTurnFileDiffInput(value: unknown): TurnFileDiffInput {
  if (!isTurnFileDiffInput(value)) throw new Error("Provide a valid agent and file path.");
  return { agentId: value.agentId, path: value.path };
}

export function isTurnFileDiffResult(value: unknown): value is TurnFileDiffResult {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.path, INPUT_LIMITS.path) &&
    isString(value.diff) &&
    value.diff.length <= INPUT_LIMITS.messageText &&
    (value.content === undefined || (isString(value.content) && value.content.length <= INPUT_LIMITS.messageText))
  );
}
