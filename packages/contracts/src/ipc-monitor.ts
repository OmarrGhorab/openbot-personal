// The Monitor: one typed snapshot of what the agents of one channel do, and the change event that
// tells a window to read it again. Main builds the snapshot from the local sources (the channel
// page, the agents' tasks, the mailbox and the live agent events) and redacts the tool-call text
// before it sends it. The web client builds the same shape from the host's Team API data with
// `buildMonitorSnapshot` below, so both surfaces read one contract.

import { type AgentProviderRef, isAgentProviderRef } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
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
}

export function monitorAgentTaskState(task: AgentTask): MonitorTaskState {
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
function stepTool(step: Pick<ConversationTraceStep, "command" | "recipientAgentIds">): string {
  if (step.command) return "shell";
  if (step.recipientAgentIds?.length) return "send_message";
  return "tool";
}

function traceToolCalls(
  agentId: string,
  taskId: string | null,
  message: ChannelMessage["message"],
): MonitorToolCall[] {
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
    if (!entry || entry.author.kind !== "agent" || entry.author.id !== agentId || !entry.message.plan) continue;
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
          state: monitorAgentTaskState(task),
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
    if (!exchange || exchange.direction !== "outgoing") return [];
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
    const agentIds = [exchange.senderAgentId, exchange.recipientAgentId].sort() as [string, string];
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
          state: monitorAgentTaskState(task),
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
