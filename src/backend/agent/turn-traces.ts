import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  CONVERSATION_TRACE_FILE_LIMIT,
  CONVERSATION_TRACE_STEP_LIMIT,
  CONVERSATION_TRACE_TEXT_LIMIT,
  type ConversationMessage,
  type ConversationTraceStep,
  type ConversationTraceStepFile,
  type ConversationTraceStepKind,
  type ConversationTurnTrace,
  type TurnStepFile,
} from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";

interface RunningTrace {
  startedAt: string;
  steps: Map<string, ConversationTraceStep>;
}

/**
 * Owns the steps of each running turn, by provider item id, until the turn ends. The providers send
 * no times, so each time is when the host got the event. A turn ends with `take`, which removes it;
 * only a turn that `begin` started records steps, so a compaction turn keeps nothing here.
 */
/**
 * The files of a step after an event. The first event names the files; a later one, such as the
 * completed item that carries the whole tool input, adds the counts and the diff that the first one
 * did not have. A file keeps the first value it got.
 */
function mergeTraceFiles(
  current: ConversationTraceStepFile[] | undefined,
  incoming: readonly ConversationTraceStepFile[],
): ConversationTraceStepFile[] {
  const files = current ? [...current] : [];
  for (const file of incoming) {
    const index = files.findIndex((candidate) => candidate.path === file.path);
    const existing = files[index];
    if (existing) {
      files[index] = {
        path: existing.path,
        status: existing.status,
        ...optionalCounts({
          additions: existing.additions ?? file.additions,
          deletions: existing.deletions ?? file.deletions,
        }),
        ...((existing.diff ?? file.diff) ? { diff: existing.diff ?? file.diff } : {}),
      };
      continue;
    }
    if (files.length >= CONVERSATION_TRACE_FILE_LIMIT) continue;
    files.push({
      path: file.path,
      status: file.status,
      ...optionalCounts(file),
      ...(file.diff === undefined ? {} : { diff: file.diff }),
    });
  }
  return files;
}

function optionalCounts(counts: { additions?: number | undefined; deletions?: number | undefined }) {
  return {
    ...(counts.additions === undefined ? {} : { additions: counts.additions }),
    ...(counts.deletions === undefined ? {} : { deletions: counts.deletions }),
  };
}

export class TurnTraces {
  readonly #turns = new Map<string, RunningTrace>();

  begin(turnId: string, startedAt: string): void {
    this.#turns.set(turnId, { startedAt, steps: new Map() });
  }

  /**
   * Records an item event. The first event of an item starts its step; a completion ends it. A later
   * event can change the kind between thinking and message, because Claude marks its thinking late.
   * `text` is the progress text of a tool step; the text of the first event stays. The command and the
   * recipients of a tool step come with its start, but a provider can send them later, so the first
   * event that has them sets them.
   */
  observe(
    turnId: string,
    itemId: string,
    kind: ConversationTraceStepKind,
    event: {
      completed: boolean;
      failed?: boolean;
      text?: string | null;
      command?: string | null;
      recipientAgentIds?: string[] | null;
      files?: TurnStepFile[] | undefined;
    },
  ): void {
    const trace = this.#turns.get(turnId);
    // A step id must pass the message guard, or the message that holds the trace would not decode.
    if (!trace || !itemId || itemId.length > INPUT_LIMITS.identifier) return;
    const now = new Date().toISOString();
    let step = trace.steps.get(itemId);
    if (!step) {
      if (trace.steps.size >= CONVERSATION_TRACE_STEP_LIMIT) return;
      step = { id: itemId, kind, startedAt: now, endedAt: null };
      trace.steps.set(itemId, step);
    }
    if (step.kind !== "tool") step.kind = kind;
    if (kind === "tool" && step.text === undefined && event.text)
      step.text = event.text.slice(0, CONVERSATION_TRACE_TEXT_LIMIT);
    // The trace stays on this computer, but a command can hold a token, as a log line can.
    const command = event.command?.trim();
    if (kind === "tool" && step.command === undefined && command)
      step.command = redactText(command).slice(0, CONVERSATION_TRACE_TEXT_LIMIT);
    if (kind === "tool" && step.recipientAgentIds === undefined && event.recipientAgentIds?.length)
      step.recipientAgentIds = [...event.recipientAgentIds];
    if (kind === "tool" && event.files?.length) step.files = mergeTraceFiles(step.files, event.files);
    if (event.completed && step.endedAt === null) step.endedAt = now;
    if (event.completed && event.failed) step.failed = true;
  }

  /** The trace of a turn that ends now, without its usage. It removes the turn. */
  take(turnId: string, endedAt: string): ConversationTurnTrace | null {
    const trace = this.#turns.get(turnId);
    this.#turns.delete(turnId);
    if (!trace) return null;
    return { startedAt: trace.startedAt, endedAt, steps: [...trace.steps.values()] };
  }

  drop(turnId: string): void {
    this.#turns.delete(turnId);
  }

  clear(): void {
    this.#turns.clear();
  }
}

/**
 * The message of a turn that holds its trace: its last answer with text, or its last thinking when
 * it has no answer. A question prompt, a plan, the subagents and the memory changes do not hold it.
 */
export function traceMessage(
  messages: readonly ConversationMessage[],
  turnId: string,
): ConversationMessage | undefined {
  let thinking: ConversationMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.author !== "assistant" || message.turnId !== turnId) continue;
    if (message.itemType === "commentary") {
      thinking ??= message;
      continue;
    }
    if (
      message.itemType === "question_prompt" ||
      message.itemType === CONVERSATION_PLAN_ITEM_TYPE ||
      message.itemType === CONVERSATION_SUBAGENTS_ITEM_TYPE ||
      message.itemType === CONVERSATION_MEMORY_CHANGES_ITEM_TYPE
    )
      continue;
    if (message.text.trim()) return message;
  }
  return thinking;
}
