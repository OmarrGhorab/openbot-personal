// The Monitor: one typed snapshot of what the agents of one channel do, and the change event that
// tells a window to read it again. Main builds the snapshot from the local sources (the channel
// page, the agents' tasks, the mailbox and the live agent events) and redacts the tool-call text
// before it sends it. The web client builds the same shape from the host's Team API data with
// `buildMonitorSnapshot` below, so both surfaces read one contract.

import { type AgentProviderRef, isAgentProviderRef } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import type { AgentEvent } from "./ipc-agent-events";
import { type AvatarHue, isAvatarHue, isAvatarSeed } from "./ipc-agent-identity";
import type { AgentTask } from "./ipc-agent-tasks";
import { integerInRange, isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import type { ChannelMessage, ChannelPage, ChannelTaskState } from "./ipc-chat-channels";
import type { ConversationTraceStep } from "./ipc-conversation-trace";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const MONITOR_AGENT_STATUSES = ["working", "waiting", "error", "idle"] as const;
export type MonitorAgentStatus = (typeof MONITOR_AGENT_STATUSES)[number];

export const MONITOR_TOOL_CALL_STATUSES = ["running", "done", "failed"] as const;
export type MonitorToolCallStatus = (typeof MONITOR_TOOL_CALL_STATUSES)[number];

/** The states of a channel task. An agent task maps onto the same list (see `monitorAgentTaskState`). */
export const MONITOR_TASK_STATES = [
  "queued",
  "running",
  "waiting",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly ChannelTaskState[];
export type MonitorTaskState = (typeof MONITOR_TASK_STATES)[number];

/** `channel`: a task of the channel coordinator. `agent`: a task an agent of the channel runs beside its own chat. */
export const MONITOR_TASK_SOURCES = ["channel", "agent"] as const;
export type MonitorTaskSource = (typeof MONITOR_TASK_SOURCES)[number];

export const MONITOR_EVENT_KINDS = ["message", "task", "tool-call", "agent-message", "agent-status"] as const;
export type MonitorEventKind = (typeof MONITOR_EVENT_KINDS)[number];

export const MONITOR_MESSAGE_AUTHOR_KINDS = ["member", "agent", "coordinator"] as const;
export type MonitorMessageAuthorKind = (typeof MONITOR_MESSAGE_AUTHOR_KINDS)[number];

/** The short argument a tool-call row shows. */
export const MONITOR_TOOL_ARGUMENT_LIMIT = 160;
/** The tool-call input or output that the detail view shows. */
export const MONITOR_TOOL_TEXT_LIMIT = 4_000;
/** The tool name, such as `shell` or `send_message`. */
export const MONITOR_TOOL_NAME_LIMIT = 80;
export const MONITOR_TASK_TITLE_LIMIT = 500;
export const MONITOR_ERROR_LIMIT = 500;
export const MONITOR_PREVIEW_LIMIT = 160;
/** The newest tool calls of a snapshot. */
export const MONITOR_TOOL_CALL_LIMIT = 300;
/** The newest feed events of a snapshot. */
export const MONITOR_EVENT_LIMIT = 300;
export const MONITOR_TASK_LIMIT = 300;
const TIME_LIMIT = 160;

/** Step n of m of the agent's current work, from its newest plan. */
export interface MonitorStep {
  /** 1-based. */
  index: number;
  total: number;
}

export interface MonitorAgent {
  id: string;
  name: string;
  provider: AgentProviderRef;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
  /** The channel's lead agent. */
  lead: boolean;
  status: MonitorAgentStatus;
  /** The task the agent works on now. Null when it works on no task. */
  currentTaskId: string | null;
  step: MonitorStep | null;
  /** When the running turn started. Null when no turn runs. */
  startedAt: string | null;
  /** What the provider reported, redacted, when the status is `error`. */
  error: string | null;
}

export interface MonitorTask {
  id: string;
  source: MonitorTaskSource;
  /** The agent that owns the task. Null for a channel task that no agent took yet. */
  agentId: string | null;
  parentTaskId: string | null;
  title: string;
  state: MonitorTaskState;
  /** Redacted. */
  error: string | null;
  /** When the task changed last. Null when the source has no time (a channel task). */
  updatedAt: string | null;
}

export interface MonitorToolCall {
  id: string;
  agentId: string;
  taskId: string | null;
  turnId: string | null;
  tool: string;
  /** The short argument, redacted. */
  argument: string;
  /** The tool input, redacted. Null when the source keeps no input. */
  input: string | null;
  /** The tool output, redacted. Null when the source keeps no output. */
  output: string | null;
  status: MonitorToolCallStatus;
  startedAt: string;
  endedAt: string | null;
  /** Null while the call runs, or when the turn ended before the call completed. */
  durationMs: number | null;
}

/** The messages between two agents of the channel, in both directions. */
export interface MonitorAgentPair {
  /** The two agent ids, in ascending order. */
  agentIds: [string, string];
  count: number;
  lastAt: string;
}

interface MonitorEventBase {
  id: string;
  at: string;
  /** The agent the event is about. Null for a person's message or a task no agent owns. */
  agentId: string | null;
}

export type MonitorEvent =
  | (MonitorEventBase & {
      kind: "message";
      messageId: string;
      authorKind: MonitorMessageAuthorKind;
      preview: string;
    })
  | (MonitorEventBase & { kind: "task"; taskId: string; state: MonitorTaskState })
  | (MonitorEventBase & { kind: "tool-call"; toolCallId: string; status: MonitorToolCallStatus })
  | (MonitorEventBase & { kind: "agent-message"; fromAgentId: string; toAgentId: string })
  | (MonitorEventBase & { kind: "agent-status"; status: MonitorAgentStatus });

export interface MonitorSnapshot {
  channelId: string;
  channelName: string;
  /** Grows with each change main sends for the channel. Use it to drop an older read. */
  revision: number;
  generatedAt: string;
  agents: MonitorAgent[];
  tasks: MonitorTask[];
  /** Newest first. */
  toolCalls: MonitorToolCall[];
  pairs: MonitorAgentPair[];
  /** Newest first. */
  events: MonitorEvent[];
}

export interface MonitorSnapshotInput {
  channelId: string;
}

/** Main sends this when the snapshot of a channel changed. The window reads the snapshot again. */
export interface MonitorChange {
  channelId: string;
  revision: number;
}

export function parseMonitorSnapshotInput(value: unknown): MonitorSnapshotInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.channelId)) throw new Error("Provide a valid channel.");
  return { channelId: value.channelId };
}

/** The newest messages the conversation drawer lists. The drawer's count still shows every message. */
export const MONITOR_CONVERSATION_MESSAGE_LIMIT = 200;
/** The text of one message in the conversation drawer. */
export const MONITOR_MESSAGE_TEXT_LIMIT = 4_000;

export interface MonitorConversationInput {
  channelId: string;
  agentIds: [string, string];
}

/** One message between two agents of a channel, from the mailbox. */
export interface MonitorConversationMessage {
  id: string;
  senderAgentId: string;
  recipientAgentId: string;
  at: string;
  /** Redacted. */
  text: string;
}

/** The messages between two agents of a channel, oldest first. `total` counts all of them. */
export interface MonitorConversation {
  channelId: string;
  agentIds: [string, string];
  messages: MonitorConversationMessage[];
  total: number;
}

/** One mailbox delivery of a channel message to an agent, with the message text. */
export interface MonitorConversationEntry {
  messageId: string;
  senderAgentId: string;
  recipientAgentId: string;
  at: string;
  text: string;
}

export function parseMonitorConversationInput(value: unknown): MonitorConversationInput {
  const ids = isDynamicRecord(value) ? value.agentIds : undefined;
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.channelId) ||
    !Array.isArray(ids) ||
    ids.length !== 2 ||
    !isIdentifier(ids[0]) ||
    !isIdentifier(ids[1]) ||
    ids[0] === ids[1]
  ) {
    throw new Error("Provide a valid channel and two different agents.");
  }
  return { channelId: value.channelId, agentIds: [ids[0], ids[1]] };
}

/**
 * The conversation between two agents, from the mailbox entries of a channel. Only the entries
 * between the two agents count, the same way the snapshot counts a pair. The text is redacted here.
 */
export function buildMonitorConversation(
  input: MonitorConversationInput,
  entries: readonly MonitorConversationEntry[],
  redact: (text: string) => string,
): MonitorConversation {
  const [left, right] = input.agentIds;
  const between = entries
    .filter(
      (entry) =>
        (entry.senderAgentId === left && entry.recipientAgentId === right) ||
        (entry.senderAgentId === right && entry.recipientAgentId === left),
    )
    .sort((first, second) => first.at.localeCompare(second.at));
  const messages = between.slice(-MONITOR_CONVERSATION_MESSAGE_LIMIT).map((entry) => ({
    id: `${entry.messageId}:${entry.recipientAgentId}`.slice(0, INPUT_LIMITS.identifier * 2 + 1),
    senderAgentId: entry.senderAgentId,
    recipientAgentId: entry.recipientAgentId,
    at: entry.at,
    text: truncate(redact(entry.text), MONITOR_MESSAGE_TEXT_LIMIT),
  }));
  return { channelId: input.channelId, agentIds: input.agentIds, messages, total: between.length };
}

function isMonitorConversationMessage(value: unknown): value is MonitorConversationMessage {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.id, INPUT_LIMITS.identifier * 2 + 1) &&
    isIdentifier(value.senderAgentId) &&
    isIdentifier(value.recipientAgentId) &&
    isTime(value.at) &&
    isBoundedString(value.text, MONITOR_MESSAGE_TEXT_LIMIT)
  );
}

export function isMonitorConversation(value: unknown): value is MonitorConversation {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.channelId) &&
    Array.isArray(value.agentIds) &&
    value.agentIds.length === 2 &&
    isIdentifier(value.agentIds[0]) &&
    isIdentifier(value.agentIds[1]) &&
    isCount(value.total) &&
    boundedList(value.messages, MONITOR_CONVERSATION_MESSAGE_LIMIT, isMonitorConversationMessage)
  );
}

const isTime = (value: unknown): value is string => isBoundedString(value, TIME_LIMIT);
const isCount = (value: unknown): value is number => integerInRange(value, 0, Number.MAX_SAFE_INTEGER);

function isMonitorStep(value: unknown): value is MonitorStep {
  return (
    isDynamicRecord(value) &&
    integerInRange(value.index, 1, 10_000) &&
    integerInRange(value.total, 1, 10_000) &&
    value.index <= value.total
  );
}

function isMonitorAgent(value: unknown): value is MonitorAgent {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isAgentProviderRef(value.provider) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    isNullableBoundedString(value.avatarUrl, INPUT_LIMITS.avatarUrl) &&
    typeof value.lead === "boolean" &&
    isOneOf(MONITOR_AGENT_STATUSES, value.status) &&
    (value.currentTaskId === null || isIdentifier(value.currentTaskId)) &&
    (value.step === null || isMonitorStep(value.step)) &&
    (value.startedAt === null || isTime(value.startedAt)) &&
    isNullableBoundedString(value.error, MONITOR_ERROR_LIMIT)
  );
}

function isMonitorTask(value: unknown): value is MonitorTask {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(MONITOR_TASK_SOURCES, value.source) &&
    (value.agentId === null || isIdentifier(value.agentId)) &&
    (value.parentTaskId === null || isIdentifier(value.parentTaskId)) &&
    isBoundedString(value.title, MONITOR_TASK_TITLE_LIMIT) &&
    isOneOf(MONITOR_TASK_STATES, value.state) &&
    isNullableBoundedString(value.error, MONITOR_ERROR_LIMIT) &&
    (value.updatedAt === null || isTime(value.updatedAt))
  );
}

function isMonitorToolCall(value: unknown): value is MonitorToolCall {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.id, INPUT_LIMITS.identifier * 2 + 1) &&
    isIdentifier(value.agentId) &&
    (value.taskId === null || isIdentifier(value.taskId)) &&
    (value.turnId === null || isIdentifier(value.turnId)) &&
    isBoundedString(value.tool, MONITOR_TOOL_NAME_LIMIT) &&
    isBoundedString(value.argument, MONITOR_TOOL_ARGUMENT_LIMIT) &&
    isNullableBoundedString(value.input, MONITOR_TOOL_TEXT_LIMIT) &&
    isNullableBoundedString(value.output, MONITOR_TOOL_TEXT_LIMIT) &&
    isOneOf(MONITOR_TOOL_CALL_STATUSES, value.status) &&
    isTime(value.startedAt) &&
    (value.endedAt === null || isTime(value.endedAt)) &&
    (value.durationMs === null || isCount(value.durationMs))
  );
}

function isMonitorAgentPair(value: unknown): value is MonitorAgentPair {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.agentIds) &&
    value.agentIds.length === 2 &&
    value.agentIds.every(isIdentifier) &&
    integerInRange(value.count, 1, Number.MAX_SAFE_INTEGER) &&
    isTime(value.lastAt)
  );
}

function isMonitorEvent(value: unknown): value is MonitorEvent {
  if (
    !isDynamicRecord(value) ||
    !isBoundedString(value.id, INPUT_LIMITS.identifier * 3) ||
    !isTime(value.at) ||
    !(value.agentId === null || isIdentifier(value.agentId))
  ) {
    return false;
  }
  switch (value.kind) {
    case "message":
      return (
        isIdentifier(value.messageId) &&
        isOneOf(MONITOR_MESSAGE_AUTHOR_KINDS, value.authorKind) &&
        isBoundedString(value.preview, MONITOR_PREVIEW_LIMIT)
      );
    case "task":
      return isIdentifier(value.taskId) && isOneOf(MONITOR_TASK_STATES, value.state);
    case "tool-call":
      return (
        isBoundedString(value.toolCallId, INPUT_LIMITS.identifier * 2 + 1) &&
        isOneOf(MONITOR_TOOL_CALL_STATUSES, value.status)
      );
    case "agent-message":
      return isIdentifier(value.fromAgentId) && isIdentifier(value.toAgentId);
    case "agent-status":
      return isOneOf(MONITOR_AGENT_STATUSES, value.status);
    default:
      return false;
  }
}

function boundedList<T>(value: unknown, limit: number, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= limit && value.every(guard);
}

export function isMonitorSnapshot(value: unknown): value is MonitorSnapshot {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.channelId) &&
    isBoundedString(value.channelName, INPUT_LIMITS.agentName) &&
    isCount(value.revision) &&
    isTime(value.generatedAt) &&
    boundedList(value.agents, INPUT_LIMITS.agents, isMonitorAgent) &&
    boundedList(value.tasks, MONITOR_TASK_LIMIT, isMonitorTask) &&
    boundedList(value.toolCalls, MONITOR_TOOL_CALL_LIMIT, isMonitorToolCall) &&
    boundedList(value.pairs, (INPUT_LIMITS.agents * (INPUT_LIMITS.agents - 1)) / 2, isMonitorAgentPair) &&
    boundedList(value.events, MONITOR_EVENT_LIMIT, isMonitorEvent)
  );
}

export function isMonitorChange(value: unknown): value is MonitorChange {
  return isDynamicRecord(value) && isIdentifier(value.channelId) && isCount(value.revision);
}

// ---------------------------------------------------------------------------------------------
// Building the snapshot. Pure: main and the web client give it what they read, and it answers the
// contract shape. It does not redact; main redacts the result before it leaves the process.
// ---------------------------------------------------------------------------------------------

/** An agent as the sources know it. `ClientAgentSummary` fits. */
export interface MonitorAgentSource {
  id: string;
  name: string;
  provider: AgentProviderRef;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
}

/** One tool step of a running turn, from its `turn-progress` events. */
export interface MonitorLiveStep {
  id: string;
  text: string;
  startedAt: string;
  endedAt: string | null;
}

/** A turn that runs now in the channel, from the agent events. */
export interface MonitorLiveTurn {
  agentId: string;
  turnId: string;
  taskId: string | null;
  startedAt: string;
  steps: MonitorLiveStep[];
}

/** A message one agent sent to another in the channel, from the mailbox. */
export interface MonitorExchange {
  messageId: string;
  senderAgentId: string;
  recipientAgentId: string;
  at: string;
}

export interface MonitorAgentAttention {
  agentId: string;
  kind: "waiting" | "error";
  /** The error text, for `error`. */
  detail: string | null;
  at: string;
}

/** The tool steps of one finished task turn, from `readTask`. */
export interface MonitorTaskTrace {
  agentId: string;
  taskId: string;
  messages: ChannelMessage["message"][];
}

export interface MonitorSources {
  generatedAt: string;
  revision: number;
  page: Pick<ChannelPage, "channel" | "messages" | "tasks">;
  agents: MonitorAgentSource[];
  agentTasks: AgentTask[];
  taskTraces: MonitorTaskTrace[];
  liveTurns: MonitorLiveTurn[];
  exchanges: MonitorExchange[];
  attention: MonitorAgentAttention[];
  /** The agent tasks that `pauseTask` holds on this computer. Absent on a host that cannot pause. */
  pausedTaskIds?: ReadonlySet<string>;
}

/** `paused` is the hold of `pauseTask`: an open task whose queue waits. A closed task is never paused. */
export function monitorAgentTaskState(task: AgentTask, paused = false): MonitorTaskState {
  if (paused && task.state !== "closed") return "paused";
  if (task.state === "running") return "running";
  if (task.state === "queued") return "queued";
  if (task.outcome === "failed") return "failed";
  if (task.outcome === "interrupted") return "cancelled";
  if (task.state === "closed" || task.outcome === "completed") return "completed";
  return "waiting";
}

const truncate = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const elapsed = (start: string, end: string | null): number | null => {
  if (!end) return null;
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const newestFirst = <T extends { at: string }>(left: T, right: T) => right.at.localeCompare(left.at);

/**
 * The tool of a trace step. The trace keeps only the shell command and the recipients of an OpenBot
 * message, so every other step is a `tool` whose argument is its progress text.
 */
function stepTool(
  step: Pick<ConversationTraceStep, "command" | "recipientAgentIds">,
): "shell" | "send_message" | "tool" {
  if (step.command) return "shell";
  if (step.recipientAgentIds?.length) return "send_message";
  return "tool";
}

function traceToolCalls(agentId: string, taskId: string | null, message: ChannelMessage["message"]): MonitorToolCall[] {
  const trace = message.trace;
  if (!trace) return [];
  return trace.steps
    .filter((step) => step.kind === "tool")
    .map((step) => {
      const argument = step.command ?? step.text ?? (step.recipientAgentIds ?? []).join(", ");
      return {
        id: `${message.turnId ?? message.id}:${step.id}`.slice(0, INPUT_LIMITS.identifier * 2 + 1),
        agentId,
        taskId,
        turnId: message.turnId ?? null,
        tool: stepTool(step),
        argument: truncate(argument, MONITOR_TOOL_ARGUMENT_LIMIT),
        input: step.command ? truncate(step.command, MONITOR_TOOL_TEXT_LIMIT) : null,
        output: null,
        status: step.failed ? "failed" : step.endedAt ? "done" : "failed",
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        durationMs: elapsed(step.startedAt, step.endedAt),
      } satisfies MonitorToolCall;
    });
}

function liveToolCalls(turn: MonitorLiveTurn): MonitorToolCall[] {
  return turn.steps.map((step) => ({
    id: `${turn.turnId}:${step.id}`.slice(0, INPUT_LIMITS.identifier * 2 + 1),
    agentId: turn.agentId,
    taskId: turn.taskId,
    turnId: turn.turnId,
    tool: "tool",
    argument: truncate(step.text, MONITOR_TOOL_ARGUMENT_LIMIT),
    input: null,
    output: null,
    status: step.endedAt ? "done" : "running",
    startedAt: step.startedAt,
    endedAt: step.endedAt,
    durationMs: elapsed(step.startedAt, step.endedAt),
  }));
}

/** Step n of m from the newest plan an agent posted in the channel. */
function planStep(messages: ChannelMessage[], agentId: string): MonitorStep | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry?.author.kind !== "agent" || entry.author.id !== agentId || !entry.message.plan) continue;
    const steps = entry.message.plan.steps;
    if (steps.length === 0) return null;
    const done = steps.filter((step) => step.status === "completed").length;
    return { index: Math.min(steps.length, done + 1), total: steps.length };
  }
  return null;
}

export function buildMonitorSnapshot(sources: MonitorSources): MonitorSnapshot {
  const { page } = sources;
  const memberIds = new Set(page.channel.members.map((member) => member.agentId));
  const agentsById = new Map(sources.agents.map((agent) => [agent.id, agent]));

  const tasks: MonitorTask[] = [
    ...page.tasks.map(
      (task): MonitorTask => ({
        id: task.id,
        source: "channel",
        agentId: task.ownerAgentId,
        parentTaskId: task.parentTaskId,
        title: truncate(task.instruction, MONITOR_TASK_TITLE_LIMIT),
        state: task.state,
        error: task.error === null ? null : truncate(task.error, MONITOR_ERROR_LIMIT),
        updatedAt: null,
      }),
    ),
    ...sources.agentTasks
      .filter((task) => memberIds.has(task.agentId))
      .map(
        (task): MonitorTask => ({
          id: task.id,
          source: "agent",
          agentId: task.agentId,
          parentTaskId: null,
          title: truncate(task.title, MONITOR_TASK_TITLE_LIMIT),
          state: monitorAgentTaskState(task, sources.pausedTaskIds?.has(task.id) === true),
          error: task.error === null ? null : truncate(task.error, MONITOR_ERROR_LIMIT),
          updatedAt: task.updatedAt,
        }),
      ),
  ].slice(0, MONITOR_TASK_LIMIT);

  const liveTurns = sources.liveTurns.filter((turn) => memberIds.has(turn.agentId));
  const toolCalls = [
    ...page.messages.flatMap((entry) =>
      entry.author.kind === "agent" && memberIds.has(entry.author.id)
        ? traceToolCalls(entry.author.id, entry.taskId, entry.message)
        : [],
    ),
    ...sources.taskTraces
      .filter((trace) => memberIds.has(trace.agentId))
      .flatMap((trace) => trace.messages.flatMap((message) => traceToolCalls(trace.agentId, trace.taskId, message))),
    ...liveTurns.flatMap(liveToolCalls),
  ];
  const uniqueToolCalls = [...new Map(toolCalls.map((call) => [call.id, call])).values()]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, MONITOR_TOOL_CALL_LIMIT);

  // The mailbox, and the agent-message summaries the channel transcript carries. A message can be
  // in both; it counts once per recipient.
  const pageExchanges = page.messages.flatMap((entry): MonitorExchange[] => {
    const exchange = entry.message.exchange;
    if (exchange?.direction !== "outgoing") return [];
    return exchange.recipientAgentIds.map((recipientAgentId) => ({
      messageId: exchange.messageId,
      senderAgentId: exchange.senderAgentId,
      recipientAgentId,
      at: entry.message.createdAt,
    }));
  });
  const allExchanges = [
    ...new Map(
      [...sources.exchanges, ...pageExchanges].map((exchange) => [
        `${exchange.messageId}\n${exchange.recipientAgentId}`,
        exchange,
      ]),
    ).values(),
  ];
  const exchanges = allExchanges.filter(
    (exchange) =>
      memberIds.has(exchange.senderAgentId) &&
      memberIds.has(exchange.recipientAgentId) &&
      exchange.senderAgentId !== exchange.recipientAgentId,
  );
  const pairs = new Map<string, MonitorAgentPair>();
  for (const exchange of exchanges) {
    const { senderAgentId: sender, recipientAgentId: recipient } = exchange;
    const agentIds: [string, string] = sender < recipient ? [sender, recipient] : [recipient, sender];
    const key = agentIds.join("\n");
    const pair = pairs.get(key);
    if (!pair) pairs.set(key, { agentIds, count: 1, lastAt: exchange.at });
    else {
      pair.count += 1;
      if (exchange.at > pair.lastAt) pair.lastAt = exchange.at;
    }
  }

  const agents: MonitorAgent[] = [];
  const statusEvents: MonitorEvent[] = [];
  for (const member of page.channel.members) {
    const source = agentsById.get(member.agentId);
    if (!source) continue;
    const live = liveTurns.find((turn) => turn.agentId === member.agentId) ?? null;
    const attention = sources.attention
      .filter((entry) => entry.agentId === member.agentId)
      .sort(newestFirst)
      .at(0);
    const ownTask =
      page.tasks.find(
        (task) => task.ownerAgentId === member.agentId && (task.state === "running" || task.state === "waiting"),
      ) ??
      sources.agentTasks.find((task) => task.agentId === member.agentId && task.state === "running") ??
      null;
    let status: MonitorAgentStatus = "idle";
    if (attention?.kind === "waiting") status = "waiting";
    else if (live || (ownTask && "ownerAgentId" in ownTask && ownTask.state === "running")) status = "working";
    else if (attention?.kind === "error") status = "error";
    else if (ownTask && "ownerAgentId" in ownTask && ownTask.state === "waiting") status = "waiting";
    else if (ownTask) status = "working";
    agents.push({
      id: source.id,
      name: source.name,
      provider: source.provider,
      avatarSeed: source.avatarSeed,
      avatarHue: source.avatarHue,
      avatarUrl: source.avatarUrl,
      lead: page.channel.leadAgentId === source.id,
      status,
      currentTaskId: live?.taskId ?? ownTask?.id ?? null,
      step: status === "working" ? planStep(page.messages, source.id) : null,
      startedAt: live?.startedAt ?? null,
      error: status === "error" && attention?.detail ? truncate(attention.detail, MONITOR_ERROR_LIMIT) : null,
    });
    if (attention) {
      statusEvents.push({
        id: `status:${source.id}:${attention.at}`,
        at: attention.at,
        agentId: source.id,
        kind: "agent-status",
        status: attention.kind,
      });
    }
    if (live) {
      statusEvents.push({
        id: `status:${source.id}:${live.turnId}`,
        at: live.startedAt,
        agentId: source.id,
        kind: "agent-status",
        status: "working",
      });
    }
  }

  const events: MonitorEvent[] = [
    ...page.messages
      .filter((entry) => !entry.superseded)
      .map(
        (entry): MonitorEvent => ({
          id: `message:${entry.id}`,
          at: entry.message.createdAt,
          agentId: entry.author.kind === "agent" ? entry.author.id : null,
          kind: "message",
          messageId: entry.id,
          authorKind: entry.author.kind,
          preview: truncate(entry.message.text.replace(/\s+/gu, " ").trim(), MONITOR_PREVIEW_LIMIT),
        }),
      ),
    ...sources.agentTasks
      .filter((task) => memberIds.has(task.agentId))
      .map(
        (task): MonitorEvent => ({
          id: `task:${task.id}:${task.updatedAt}`,
          at: task.updatedAt,
          agentId: task.agentId,
          kind: "task",
          taskId: task.id,
          state: monitorAgentTaskState(task, sources.pausedTaskIds?.has(task.id) === true),
        }),
      ),
    ...uniqueToolCalls.map(
      (call): MonitorEvent => ({
        id: `tool:${call.id}`,
        at: call.endedAt ?? call.startedAt,
        agentId: call.agentId,
        kind: "tool-call",
        toolCallId: call.id,
        status: call.status,
      }),
    ),
    ...exchanges.map(
      (exchange): MonitorEvent => ({
        id: `exchange:${exchange.messageId}:${exchange.recipientAgentId}`,
        at: exchange.at,
        agentId: exchange.senderAgentId,
        kind: "agent-message",
        fromAgentId: exchange.senderAgentId,
        toAgentId: exchange.recipientAgentId,
      }),
    ),
    ...statusEvents,
  ]
    .sort(newestFirst)
    .slice(0, MONITOR_EVENT_LIMIT);

  return {
    channelId: page.channel.id,
    channelName: page.channel.name,
    revision: sources.revision,
    generatedAt: sources.generatedAt,
    agents,
    tasks,
    toolCalls: uniqueToolCalls,
    pairs: [...pairs.values()].sort((left, right) => right.lastAt.localeCompare(left.lastAt)),
    events,
  };
}

// ---------------------------------------------------------------------------------------------
// Redaction and the live state. Both surfaces use them: main on the local agent events, the web
// client on the host's events. The redactor is a parameter, because contracts import no logging.
// ---------------------------------------------------------------------------------------------

/**
 * Removes secrets from every tool-call text and error of a snapshot. The redaction marker can make
 * a text longer, so each text is cut to its bound again after it.
 */
export function redactMonitorSnapshot(snapshot: MonitorSnapshot, redact: (text: string) => string): MonitorSnapshot {
  const nullable = (text: string | null, limit: number) => (text === null ? null : truncate(redact(text), limit));
  return {
    ...snapshot,
    agents: snapshot.agents.map((agent) => ({ ...agent, error: nullable(agent.error, MONITOR_ERROR_LIMIT) })),
    tasks: snapshot.tasks.map((task) => ({ ...task, error: nullable(task.error, MONITOR_ERROR_LIMIT) })),
    toolCalls: snapshot.toolCalls.map((call) => ({
      ...call,
      argument: truncate(redact(call.argument), MONITOR_TOOL_ARGUMENT_LIMIT),
      input: nullable(call.input, MONITOR_TOOL_TEXT_LIMIT),
      output: nullable(call.output, MONITOR_TOOL_TEXT_LIMIT),
    })),
  };
}

/** The steps of one live turn that a snapshot keeps. Older steps are in the turn's trace when it ends. */
const LIVE_STEP_LIMIT = 50;

/** A live turn with the thread it runs in. */
export interface MonitorLiveThreadTurn extends MonitorLiveTurn {
  threadId: string;
  /** The channel of a member thread. Null for an agent task, the agent's own chat, or when unknown. */
  channelId: string | null;
}

/** What the live state asks its surface about a thread. */
export interface MonitorThreadLookup {
  /** The channel whose member thread this is, or null. */
  channelForThread(threadId: string): string | null;
  /** The agent task that runs in this thread, or null. */
  taskIdForThread(agentId: string, threadId: string): string | null;
}

/**
 * What an agent event changed, so the surface knows which channel to read again. `agent`: the
 * channels the agent is a member of, or only `channelId` when it is known. `all`: every channel.
 */
export type MonitorLiveChange =
  | { kind: "agent"; agentId: string; channelId: string | null }
  | { kind: "channel"; channelId: string }
  | { kind: "all" };

/**
 * The turns that run now and the newest prompt, approval or error of each agent, kept from the
 * agent events. It lives as long as its process or tab; nothing is stored.
 */
export class MonitorLiveState {
  readonly #lookup: MonitorThreadLookup;
  readonly #turns = new Map<string, MonitorLiveThreadTurn>();
  readonly #attention = new Map<string, MonitorAgentAttention>();

  constructor(lookup: MonitorThreadLookup) {
    this.#lookup = lookup;
  }

  /** The live turns of the members, in the channel or outside any channel. */
  turns(members: ReadonlySet<string>, channelId: string): MonitorLiveTurn[] {
    return [...this.#turns.values()].filter(
      (turn) => members.has(turn.agentId) && (turn.channelId === null || turn.channelId === channelId),
    );
  }

  attention(members: ReadonlySet<string>): MonitorAgentAttention[] {
    return [...this.#attention.values()].filter((entry) => members.has(entry.agentId));
  }

  /** Forgets every turn, such as when the web client connects to another host. */
  clear(): void {
    this.#turns.clear();
    this.#attention.clear();
  }

  /** Keeps the live state from one event. Returns what changed, or null when the Monitor does not care. */
  observe(event: AgentEvent, at: string): MonitorLiveChange | null {
    switch (event.type) {
      case "turn-started": {
        const channelId = this.#lookup.channelForThread(event.threadId);
        this.#turns.set(event.turnId, {
          agentId: event.agentId,
          threadId: event.threadId,
          turnId: event.turnId,
          taskId: this.#lookup.taskIdForThread(event.agentId, event.threadId),
          channelId,
          startedAt: at,
          steps: [],
        });
        if (this.#attention.get(event.agentId)?.kind === "error") this.#attention.delete(event.agentId);
        return { kind: "agent", agentId: event.agentId, channelId };
      }
      case "turn-progress": {
        const turn = this.#turns.get(event.turnId);
        if (!turn) return null;
        const running = turn.steps.at(-1);
        if (running && running.endedAt === null) running.endedAt = at;
        turn.steps.push({ id: String(turn.steps.length + 1), text: event.detail, startedAt: at, endedAt: null });
        if (turn.steps.length > LIVE_STEP_LIMIT) turn.steps.shift();
        return { kind: "agent", agentId: turn.agentId, channelId: turn.channelId };
      }
      case "turn-completed": {
        const turn = this.#turns.get(event.turnId);
        this.#turns.delete(event.turnId);
        if (event.status === "failed") {
          this.#attention.set(event.agentId, { agentId: event.agentId, kind: "error", detail: null, at });
        }
        return { kind: "agent", agentId: event.agentId, channelId: turn?.channelId ?? null };
      }
      case "error":
        if (!event.agentId) return null;
        this.#attention.set(event.agentId, { agentId: event.agentId, kind: "error", detail: event.message, at });
        return { kind: "agent", agentId: event.agentId, channelId: null };
      case "prompt":
        this.#attention.set(event.agentId, { agentId: event.agentId, kind: "waiting", detail: null, at });
        return { kind: "agent", agentId: event.agentId, channelId: null };
      case "approval":
        this.#attention.set(event.approval.agentId, {
          agentId: event.approval.agentId,
          kind: "waiting",
          detail: null,
          at,
        });
        return { kind: "agent", agentId: event.approval.agentId, channelId: null };
      case "agent-input-resolved":
        if (this.#attention.get(event.agentId)?.kind === "waiting") this.#attention.delete(event.agentId);
        return { kind: "agent", agentId: event.agentId, channelId: null };
      case "channels-changed":
        return { kind: "channel", channelId: event.channelId };
      case "agent-tasks-changed":
        return { kind: "agent", agentId: event.snapshot.agentId, channelId: null };
      case "queue-changed":
        return { kind: "agent", agentId: event.snapshot.agentId, channelId: null };
      case "agents-changed":
        return { kind: "all" };
      default:
        return null;
    }
  }
}
