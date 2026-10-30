import type { ConversationTurnTrace } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import type { AgentStep, AgentStepsFacts } from "@openbot/ui/features/conversation/AgentSteps";
import { silentAgentAnswer } from "@openbot/ui/features/conversation/new-message-tally";
import type { TraceSpan } from "@openbot/ui/features/conversation/TraceWaterfall";
import { createMemo } from "solid-js";
import type { TurnLiveStep, TurnLiveSteps } from "./turn-live-steps";
import type { TurnStepLines } from "./turn-step-lines";

const NO_STEPS: AgentStep[] = [];

/** The id of a subagent's span in a trace is this prefix and the subagent id. */
export const SUBAGENT_SPAN_PREFIX = "subagent:";
/** The id of the span of another agent's reply is this prefix and the id of the reply message. */
const REPLY_SPAN_PREFIX = "reply:";

function sameSteps(left: readonly AgentStep[], right: readonly AgentStep[]): boolean {
  return (
    left.length === right.length &&
    left.every((step, index) => {
      const other = right[index];
      if (other?.id !== step.id || other.kind !== step.kind) return false;
      if (step.kind === "memory" && other.kind === "memory" && other.change.action !== step.change.action) return false;
      return stepFingerprint(other) === stepFingerprint(step);
    })
  );
}

function stepText(step: AgentStep): string {
  return step.kind === "memory" ? step.change.text : step.text;
}

/** What a list compares: the text, and for a live step its state and payload, so an ended step redraws. */
function stepFingerprint(step: AgentStep): string {
  if (step.kind === "command") return `${step.text}\n${step.command ?? ""}\n${step.exitCode ?? ""}\n${step.status}`;
  if (step.kind === "file-change")
    return `${step.text}\n${step.files.map((file) => `${file.status}\n${file.path}`).join("\n")}\n${step.status}`;
  if (step.kind === "subagent") return `${step.text}\n${step.status}`;
  return stepText(step);
}

/** The first line of a thought, without Markdown emphasis, as the name of its row in a trace. */
function thoughtTitle(text: string): string {
  const line = text.trim().split("\n", 1)[0] ?? "";
  return line
    .replace(/^#+\s*/, "")
    .replaceAll("**", "")
    .slice(0, 120);
}

/** The words of a trace that the chat translates. */
export interface TraceLabels {
  agent: string;
  thinking: string;
  answer: string;
  progress: (text: string) => string;
  /** The row of a `send_message` call, from the names of its recipients. */
  message: (names: string) => string;
  /** The row of the call that starts a subagent, from the subagent's title. */
  subagent: (title: string) => string;
  /** The row of a file change, from the names of its files. */
  edited: (names: string) => string;
  /** The detail of the row of another agent's reply. */
  reply: string;
  /** The names of agents, from their ids. */
  agentNames: (ids: readonly string[]) => string;
}

type TimedStep = { step: AgentStep; at: number };

/**
 * The spans of a turn's stored steps. A thought takes its title from the thought with its id, and a
 * tool call takes the id of the progress line with its text, so a click on either shows it in the list.
 * A step that did not end before the turn ended ends with the turn. A message or a thought that came
 * in one piece starts where the step before it ended, so its bar shows the time the model took to
 * write it. A call that sends a message or starts a subagent is a handoff, named for whom it reached.
 */
function storedSpans(
  trace: ConversationTurnTrace,
  timed: readonly TimedStep[],
  turnEnd: number,
  subagentTitles: ReadonlyMap<string, string>,
  labels: TraceLabels,
): TraceSpan[] {
  const thoughts = new Map<string, string>();
  const lines: AgentStep[] = [];
  for (const { step } of timed) {
    if (step.kind === "thinking") thoughts.set(step.id, step.text);
    else if (step.kind === "progress") lines.push(step);
  }
  const spans: TraceSpan[] = [];
  const traceStart = Date.parse(trace.startedAt);
  let previousEnd = Number.isFinite(traceStart) ? traceStart : Number.NEGATIVE_INFINITY;
  for (const step of trace.steps) {
    const started = Date.parse(step.startedAt);
    if (!Number.isFinite(started)) continue;
    const ended = Date.parse(step.endedAt ?? "");
    const end = Math.max(started, Number.isFinite(ended) ? ended : turnEnd);
    const whole = step.kind !== "tool" && end === started;
    const start = whole && Number.isFinite(previousEnd) ? Math.min(previousEnd, started) : started;
    previousEnd = Math.max(previousEnd, end);
    const failed = step.failed === true;
    if (step.kind === "reasoning") {
      const title = thoughtTitle(thoughts.get(step.id) ?? "");
      spans.push({
        id: step.id,
        parentId: "turn",
        name: title || labels.thinking,
        kind: "model",
        icon: "thinking",
        failed,
        start,
        end,
      });
    } else if (step.kind === "tool") {
      const text = step.text ?? "";
      const line = lines.findIndex((candidate) => candidate.kind === "progress" && candidate.text === text);
      const id = line === -1 ? step.id : (lines.splice(line, 1)[0]?.id ?? step.id);
      const subagent = subagentTitles.get(step.id);
      const command = step.command?.trim().split("\n", 1)[0];
      const span: TraceSpan = { id, parentId: "turn", name: labels.progress(text), kind: "tool", failed, start, end };
      if (step.recipientAgentIds?.length) {
        span.kind = "handoff";
        span.name = labels.message(labels.agentNames(step.recipientAgentIds));
      } else if (subagent !== undefined) {
        span.kind = "handoff";
        span.name = labels.subagent(subagent);
      } else if (command) {
        span.icon = "command";
        span.name = command;
      } else if (step.files?.length) {
        const names = step.files.map((file) => file.path.split(/[\\/]/u).pop() || file.path);
        const shown = names.slice(0, 3).join(", ");
        span.name = labels.edited(names.length > 3 ? `${shown}, …` : shown);
        const additions = step.files.reduce((total, file) => total + (file.additions ?? 0), 0);
        const deletions = step.files.reduce((total, file) => total + (file.deletions ?? 0), 0);
        if (additions > 0 || deletions > 0) span.detail = `+${additions} −${deletions}`;
      }
      spans.push(span);
    } else {
      spans.push({
        id: step.id,
        parentId: "turn",
        name: labels.answer,
        kind: "model",
        icon: "text",
        failed,
        start,
        end,
      });
    }
  }
  return spans;
}

/** The spans of a turn with no stored steps: the next step's start, or `lastEnd`, ends a step. */
function guessedSpans(timed: readonly TimedStep[], lastEnd: number, labels: TraceLabels): TraceSpan[] {
  const spans: TraceSpan[] = [];
  for (const [index, { step, at }] of timed.entries()) {
    const end = Math.max(at, timed[index + 1]?.at ?? lastEnd);
    if (step.kind === "thinking") {
      spans.push({
        id: step.id,
        parentId: "turn",
        name: thoughtTitle(step.text),
        kind: "model",
        icon: "thinking",
        start: at,
        end,
      });
    } else if (step.kind === "progress") {
      spans.push({ id: step.id, parentId: "turn", name: labels.progress(step.text), kind: "tool", start: at, end });
    }
  }
  return spans;
}

/** A message that the chat draws as the agent's answer, which the steps of its turn stand above. */
export function isTurnAnswer(message: AgentMessage): boolean {
  return message.author === "agent" && message.kind === "text" && !silentAgentAnswer(message);
}

/**
 * The steps of each turn of a chat: its thoughts, the host's progress lines and its memory changes.
 * The thoughts and the memory changes are stored messages; the progress lines are in memory only.
 * After a restart, the tool steps of the stored trace take the place of the progress lines.
 */
/**
 * A stored trace step rebuilt as the live row it was: a command keeps its redacted command, a
 * file change keeps its files, and a message to another agent keeps its subagent row.
 */
function storedLiveStep(turnId: string, step: ConversationTurnTrace["steps"][number]): AgentStep | null {
  if (step.kind !== "tool" || !step.text?.trim()) return null;
  const id = `${turnId}:trace:${step.id}`;
  if (step.files?.length)
    return {
      id,
      kind: "file-change",
      text: step.text,
      files: step.files.map((file) => ({
        path: file.path,
        status: file.status,
        ...(file.additions === undefined ? {} : { additions: file.additions }),
        ...(file.deletions === undefined ? {} : { deletions: file.deletions }),
      })),
      status: step.failed === true ? "failed" : "done",
    };
  if (step.command)
    return {
      id,
      kind: "command",
      text: step.text,
      command: step.command,
      status: step.failed === true ? "failed" : "done",
    };
  if (step.recipientAgentIds?.length) return { id, kind: "subagent", text: step.text, status: "done" };
  return { id, kind: "progress", text: step.text };
}

/** A live step as the chat draws it. */
function liveAgentStep(step: TurnLiveStep): AgentStep {
  if (step.kind === "command")
    return {
      id: step.id,
      kind: "command",
      text: step.text,
      ...(step.command === undefined ? {} : { command: step.command }),
      ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
      status: step.status,
    };
  if (step.kind === "file-change")
    return {
      id: step.id,
      kind: "file-change",
      text: step.text,
      files: (step.files ?? []).map((file) => ({
        path: file.path,
        status: file.status,
        ...(file.additions === undefined ? {} : { additions: file.additions }),
        ...(file.deletions === undefined ? {} : { deletions: file.deletions }),
      })),
      status: step.status,
    };
  if (step.kind === "subagent") return { id: step.id, kind: "subagent", text: step.text, status: step.status };
  return { id: step.id, kind: "thinking", text: step.text };
}

export function createTurnSteps(deps: {
  messages: () => readonly AgentMessage[];
  lines: () => TurnStepLines | undefined;
  live: () => TurnLiveSteps | undefined;
  activeTurnId: () => string | null | undefined;
}) {
  // A thought is ordered by when the host wrote it, and a progress line by when this window got it,
  // so a line shows between the thoughts it came between. A thought with no time (from a client
  // that does not send one) uses the time this window first saw it.
  const seenAt = new Map<string, number>();
  const lists = new Map<string, AgentStep[]>();
  const sources = createMemo(() => {
    const thinking = new Map<string, AgentMessage>();
    const memory = new Map<string, AgentMessage>();
    const subagents = new Map<string, AgentMessage>();
    const answers = new Map<string, string>();
    const answerTimes = new Map<string, string>();
    const startTimes = new Map<string, string>();
    const traces = new Map<string, ConversationTurnTrace>();
    const sent = new Map<string, AgentMessage[]>();
    const replies = new Map<string, AgentMessage[]>();
    for (const message of deps.messages()) {
      const replyTo = message.exchange?.direction === "incoming" ? message.exchange.replyToMessageId : null;
      if (replyTo) replies.set(replyTo, [...(replies.get(replyTo) ?? []), message]);
      const turnId = message.turnId;
      if (!turnId) continue;
      if (message.exchange?.direction === "outgoing" && message.exchange.expectsReply !== false)
        sent.set(turnId, [...(sent.get(turnId) ?? []), message]);
      if (message.createdAt && !startTimes.has(turnId)) startTimes.set(turnId, message.createdAt);
      if (message.trace) traces.set(turnId, message.trace);
      if (message.kind === "thinking") thinking.set(turnId, message);
      else if (message.kind === "memory-changes") memory.set(turnId, message);
      else if (message.kind === "subagents") subagents.set(turnId, message);
      else if (isTurnAnswer(message) && !answers.has(turnId)) {
        answers.set(turnId, message.id);
        if (message.createdAt) answerTimes.set(turnId, message.createdAt);
      }
    }
    // The caches keep only what the chat still holds, so another page or chat frees them.
    const thoughtIds = new Set([...thinking.values()].flatMap((message) => message.itemIds ?? []));
    for (const id of seenAt.keys()) if (!thoughtIds.has(id)) seenAt.delete(id);
    const lines = deps.lines() ?? {};
    for (const turnId of lists.keys())
      if (!thinking.has(turnId) && !memory.has(turnId) && !lines[turnId] && !traces.has(turnId)) lists.delete(turnId);
    return { thinking, memory, subagents, answers, answerTimes, startTimes, traces, sent, replies };
  });

  /** The thoughts and the progress lines of a turn, each with its time, in time order. */
  function timedSteps(turnId: string): TimedStep[] {
    const { thinking } = sources();
    const now = Date.now();
    const thoughts = thinking.get(turnId);
    const timed: TimedStep[] = [];
    for (const [index, text] of (thoughts?.items ?? []).entries()) {
      if (!text.trim()) continue;
      const id = thoughts?.itemIds?.[index] ?? `${thoughts?.id}:${index}`;
      const written = Date.parse(thoughts?.itemCreatedAt?.[index] ?? "");
      const at = Number.isFinite(written) ? written : (seenAt.get(id) ?? now);
      seenAt.set(id, at);
      timed.push({ step: { id, kind: "thinking", text }, at });
    }
    const live = deps.live()?.[turnId] ?? [];
    // A live step and the progress line of the same tool call carry the same text, so a line the
    // live steps already name is not drawn twice.
    const liveTexts = new Set(live.map((step) => step.text));
    const lines = (deps.lines()?.[turnId] ?? []).filter((line) => !liveTexts.has(line.text));
    for (const line of lines) {
      timed.push({ step: { id: line.id, kind: "progress", text: line.text }, at: line.at });
    }
    for (const step of live) {
      timed.push({ step: liveAgentStep(step), at: step.at });
    }
    // After a restart the live steps and the progress lines are gone. The stored trace keeps the
    // text and start of each tool step, so the turn keeps its steps.
    if (lines.length === 0 && live.length === 0) {
      for (const step of sources().traces.get(turnId)?.steps ?? []) {
        const at = Date.parse(step.startedAt);
        if (!Number.isFinite(at)) continue;
        const rebuilt = storedLiveStep(turnId, step);
        if (rebuilt) timed.push({ step: rebuilt, at });
      }
    }
    // A stable sort keeps the thoughts in their order when they share a time.
    return timed.sort((left, right) => left.at - right.at);
  }

  function stepsOf(turnId: string | null | undefined): AgentStep[] {
    if (!turnId) return [];
    const { memory } = sources();
    const steps = timedSteps(turnId).map(({ step }) => step);
    const changes = memory.get(turnId);
    if (changes?.memoryChanges) {
      for (const [index, change] of changes.memoryChanges.entries())
        steps.push({ id: `${changes.id}:${index}`, kind: "memory", change });
    } else if (changes) {
      steps.push({ id: changes.id, kind: "memory-summary", text: changes.body });
    }
    // Each streamed word changes the messages. A turn whose steps did not change keeps its list, so
    // its row does not draw again.
    const previous = lists.get(turnId);
    if (previous && sameSteps(previous, steps)) return previous;
    lists.set(turnId, steps);
    return steps;
  }

  /**
   * The start and end of a turn, with the parts that its trace is made of. The host's start is the
   * run's start; a message of the turn can be older, because it waited in the queue.
   */
  function turnBounds(turnId: string) {
    const { subagents, answerTimes, startTimes, traces } = sources();
    const timed = timedSteps(turnId);
    const stored = traces.get(turnId);
    const answerAt = Date.parse(answerTimes.get(turnId) ?? "");
    const startAt = Date.parse(startTimes.get(turnId) ?? "");
    const ran = (subagents.get(turnId)?.subagents ?? []).map((subagent) => ({
      subagent,
      start: Date.parse(subagent.startedAt),
      end: subagent.endedAt === null ? null : Date.parse(subagent.endedAt),
    }));
    const starts = [startAt, ...timed.map(({ at }) => at), ...ran.map(({ start }) => start)].filter(Number.isFinite);
    if (starts.length === 0) return undefined;
    const lastStepAt = timed.at(-1)?.at ?? Number.NaN;
    const ends = [answerAt, lastStepAt, ...ran.map(({ end }) => end ?? Number.NaN)].filter(Number.isFinite);
    const storedStart = Date.parse(stored?.startedAt ?? "");
    const storedEnd = Date.parse(stored?.endedAt ?? "");
    const turnStart = Number.isFinite(storedStart)
      ? Math.min(storedStart, ...starts.filter((at) => at !== startAt))
      : Math.min(...starts);
    const turnEnd = Math.max(turnStart, ...ends, ...(Number.isFinite(storedEnd) ? [storedEnd] : []));
    return { timed, stored, ran, answerAt, turnStart, turnEnd };
  }

  /** The finished turn whose steps show above this message: the first answer of the turn. */
  const turnOfAnswer = createMemo(() => {
    const active = deps.activeTurnId();
    const turns = new Map<string, string>();
    for (const [turnId, messageId] of sources().answers) if (turnId !== active) turns.set(messageId, turnId);
    return turns;
  });

  return {
    /**
     * The steps of the running turn, for the activity line. None once the turn writes its answer: the
     * activity line is under the answer, and the steps then show above it when the turn ends.
     */
    activeSteps: createMemo(() => {
      const turnId = deps.activeTurnId();
      return turnId && sources().answers.has(turnId) ? NO_STEPS : stepsOf(turnId);
    }),
    /**
     * The steps of the channel turns that run, while they have no answer. A channel runs several turns
     * at once and has no single running turn.
     */
    workingSteps(turnIds: readonly string[]): AgentStep[] {
      const { answers } = sources();
      const turns = turnIds.filter((turnId) => !answers.has(turnId));
      return turns.length === 0 ? NO_STEPS : turns.flatMap(stepsOf);
    },
    /** The steps above an answer, or undefined for a message that has none. */
    stepsAbove(messageId: string | undefined): AgentStep[] | undefined {
      const turnId = messageId === undefined ? undefined : turnOfAnswer().get(messageId);
      const steps = stepsOf(turnId);
      return steps.length > 0 ? steps : undefined;
    },
    /** The time that the turn of an answer took, and how many of its steps and subagents failed. */
    factsAbove(messageId: string | undefined): AgentStepsFacts | undefined {
      const turnId = messageId === undefined ? undefined : turnOfAnswer().get(messageId);
      const turn = turnId === undefined ? undefined : turnBounds(turnId);
      if (!turn) return undefined;
      const failedSteps = turn.stored?.steps.filter((step) => step.failed === true).length ?? 0;
      const failedSubagents = turn.ran.filter(({ subagent }) => subagent.status === "failed").length;
      return { durationMs: turn.turnEnd - turn.turnStart, failed: failedSteps + failedSubagents };
    },
    /**
     * The trace of the turn of an answer: the turn, then each of its steps, and each subagent. The
     * host stores the times of each step and the usage of a turn that ends. A turn from before that
     * has only the start of each thought and progress line, so the next step's start ends a step, and
     * the answer ends the last one. A reply to a message that the turn sent shows as a wait from the
     * message to the reply, or to the turn's end when the reply came later.
     */
    traceAbove(messageId: string | undefined, labels: TraceLabels): TraceSpan[] {
      const turnId = messageId === undefined ? undefined : turnOfAnswer().get(messageId);
      const turn = turnId === undefined ? undefined : turnBounds(turnId);
      if (!turnId || !turn) return [];
      const { sent, replies } = sources();
      const { timed, stored, ran, answerAt, turnStart, turnEnd } = turn;
      const spans: TraceSpan[] = [
        {
          id: "turn",
          parentId: null,
          name: labels.agent,
          kind: "model",
          icon: "agent",
          start: turnStart,
          end: turnEnd,
          ...(stored?.tokens === undefined ? {} : { tokens: stored.tokens }),
          ...(typeof stored?.costUsd === "number" ? { costUsd: stored.costUsd } : {}),
        },
      ];
      const titles = new Map(ran.map(({ subagent }) => [subagent.id, subagent.title]));
      if (stored) spans.push(...storedSpans(stored, timed, turnEnd, titles, labels));
      else spans.push(...guessedSpans(timed, Number.isFinite(answerAt) ? answerAt : turnEnd, labels));
      for (const { subagent, start, end } of ran) {
        if (!Number.isFinite(start)) continue;
        // A subagent with no end in a finished turn stopped when the app did: it ends with the turn.
        const running = subagent.status === "running" && !stored;
        spans.push({
          id: `${SUBAGENT_SPAN_PREFIX}${subagent.id}`,
          parentId: "turn",
          name: subagent.title,
          ...(subagent.agentType ? { detail: subagent.agentType } : {}),
          kind: "model",
          icon: "agent",
          failed: subagent.status === "failed",
          start,
          end: end !== null && Number.isFinite(end) ? end : running ? null : turnEnd,
        });
      }
      for (const message of sent.get(turnId) ?? []) {
        const asked = Date.parse(message.createdAt ?? "");
        if (!message.exchange || !Number.isFinite(asked)) continue;
        for (const reply of replies.get(message.exchange.messageId) ?? []) {
          const answered = Date.parse(reply.createdAt ?? "");
          if (!reply.exchange || !Number.isFinite(answered)) continue;
          spans.push({
            id: `${REPLY_SPAN_PREFIX}${reply.id}`,
            parentId: "turn",
            name: labels.agentNames([reply.exchange.senderAgentId]),
            detail: labels.reply,
            kind: "waiting",
            icon: "agent",
            start: Math.min(asked, answered, turnEnd),
            // A reply after the turn came in a later turn: the wait shows only up to this turn's end.
            end: Math.min(answered, turnEnd),
          });
        }
      }
      return spans;
    },
    /** The steps of the turn of a memory-changes message that has no answer to stand above. */
    stepsOfTurn(turnId: string | undefined): AgentStep[] {
      return stepsOf(turnId);
    },
  };
}
