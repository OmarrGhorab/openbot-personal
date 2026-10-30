import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

/**
 * The timing of one finished turn, as the host saw it. The host stamps each time when it gets the
 * provider event, because the providers send no times. It is stored on one message of the turn (its
 * last answer, or its thinking when it has no answer) and it stays on this computer: the Team API
 * projections do not send it.
 */
export const CONVERSATION_TRACE_STEP_KINDS = ["reasoning", "tool", "message"] as const;
export type ConversationTraceStepKind = (typeof CONVERSATION_TRACE_STEP_KINDS)[number];

/** One file a tool step changed, kept so a finished turn keeps its Changes panel after a restart. */
export interface ConversationTraceStepFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface ConversationTraceStep {
  /** The provider's item id. */
  id: string;
  kind: ConversationTraceStepKind;
  /** On a tool step: the progress text that the host sent as `turn-progress` when the step started. */
  text?: string | undefined;
  /** On a shell command step: the command, with known secrets removed. */
  command?: string | undefined;
  /** On a `send_message` step: the agents that the message went to. */
  recipientAgentIds?: string[] | undefined;
  /** On a file-change step: the files it changed, up to the per-trace limit. */
  files?: ConversationTraceStepFile[] | undefined;
  startedAt: string;
  /** Null when the turn ended before the provider completed the item. */
  endedAt: string | null;
  /** Set when the provider reported the item as failed or declined. */
  failed?: true | undefined;
}

export interface ConversationTurnTrace {
  startedAt: string;
  endedAt: string | null;
  /** The first `CONVERSATION_TRACE_STEP_LIMIT` steps of the turn, in start order. */
  steps: ConversationTraceStep[];
  /** All the tokens that the provider reported for the turn: input, cached input, cache writes and output. */
  tokens?: number | undefined;
  /** The cost in US dollars. Null when one record of the turn has no cost; absent when no record has one. */
  costUsd?: number | null | undefined;
}

export const CONVERSATION_TRACE_STEP_LIMIT = 500;
export const CONVERSATION_TRACE_TEXT_LIMIT = 500;
/** The files of one trace step. The live budget is tighter; the trace keeps what it can hold. */
export const CONVERSATION_TRACE_FILE_LIMIT = 32;
const TIME_LIMIT = 160;

export function isConversationTurnTrace(value: unknown): value is ConversationTurnTrace {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.startedAt, TIME_LIMIT) &&
    isNullableBoundedString(value.endedAt, TIME_LIMIT) &&
    Array.isArray(value.steps) &&
    value.steps.length <= CONVERSATION_TRACE_STEP_LIMIT &&
    value.steps.every(isConversationTraceStep) &&
    (value.tokens === undefined || isCount(value.tokens)) &&
    (value.costUsd === undefined || value.costUsd === null || isCost(value.costUsd))
  );
}

const TRACE_FILE_STATUSES = ["added", "modified", "deleted"] as const;

function isConversationTraceStepFile(value: unknown): value is ConversationTraceStepFile {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.path, INPUT_LIMITS.path) &&
    isOneOf(TRACE_FILE_STATUSES, value.status) &&
    (value.additions === undefined || isCount(value.additions)) &&
    (value.deletions === undefined || isCount(value.deletions))
  );
}

function isConversationTraceStep(value: unknown): value is ConversationTraceStep {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(CONVERSATION_TRACE_STEP_KINDS, value.kind) &&
    (value.text === undefined || isBoundedString(value.text, CONVERSATION_TRACE_TEXT_LIMIT)) &&
    (value.command === undefined || isBoundedString(value.command, CONVERSATION_TRACE_TEXT_LIMIT)) &&
    (value.recipientAgentIds === undefined ||
      (Array.isArray(value.recipientAgentIds) &&
        value.recipientAgentIds.length <= INPUT_LIMITS.messageRecipients &&
        value.recipientAgentIds.every(isIdentifier))) &&
    (value.files === undefined ||
      (Array.isArray(value.files) &&
        value.files.length <= CONVERSATION_TRACE_FILE_LIMIT &&
        value.files.every(isConversationTraceStepFile))) &&
    isBoundedString(value.startedAt, TIME_LIMIT) &&
    isNullableBoundedString(value.endedAt, TIME_LIMIT) &&
    (value.failed === undefined || value.failed === true)
  );
}

function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isCost(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value) && value >= 0;
}
