import type {
  MonitorAgent,
  MonitorAgentStatus,
  MonitorEvent,
  MonitorMessageAuthorKind,
  MonitorSnapshot,
  MonitorTaskState,
} from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { AppTextKey } from "@openbot/i18n";
import type { MonitorStatus } from "@openbot/ui/features/monitor/monitor-status";

/**
 * How many events of `next` the view of `shown` does not have. An event is new when its id is not
 * in `shown`; a tool call that ends keeps its id, so it is not counted twice.
 */
export function countNewMonitorEvents(shown: MonitorSnapshot, next: MonitorSnapshot): number {
  if (shown.channelId !== next.channelId) return next.events.length;
  const known = new Set(shown.events.map((event) => event.id));
  let count = 0;
  for (const event of next.events) if (!known.has(event.id)) count += 1;
  return count;
}

/** The verb of a task event, by the state the task reached. */
export const MONITOR_FEED_TASK_VERB = {
  queued: "monitor.feed.task.queued",
  running: "monitor.feed.task.running",
  waiting: "monitor.feed.task.waiting",
  paused: "monitor.feed.task.paused",
  completed: "monitor.feed.task.completed",
  failed: "monitor.feed.task.failed",
  cancelled: "monitor.feed.task.cancelled",
} as const satisfies Record<MonitorTaskState, AppTextKey>;

/** The verb of a status event. */
export const MONITOR_FEED_STATUS_VERB = {
  working: "monitor.feed.status.working",
  waiting: "monitor.feed.status.waiting",
  error: "monitor.feed.status.error",
  idle: "monitor.feed.status.idle",
} as const satisfies Record<MonitorAgentStatus, AppTextKey>;

/** Who wrote a channel message that no agent of the channel wrote. */
export const MONITOR_FEED_AUTHOR = {
  member: "monitor.feed.author.member",
  agent: "monitor.feed.author.agent",
  coordinator: "monitor.feed.author.coordinator",
} as const satisfies Record<MonitorMessageAuthorKind, AppTextKey>;

/** One feed event, resolved against its snapshot. The view turns it into text. */
export type MonitorFeedEntry = {
  id: string;
  at: string;
  /** The agent the event is about, when the channel still has it. */
  agent: MonitorAgent | null;
  /** The colour of the target and the border of the card. Only `error` and `done` change them. */
  tone: MonitorStatus | null;
} & (
  | { kind: "message"; authorKind: MonitorMessageAuthorKind; preview: string }
  | {
      kind: "task";
      state: MonitorTaskState;
      title: string | null;
      error: string | null;
      /** Step n of m, when the agent works on this task now. */
      step: MonitorAgent["step"];
    }
  | {
      kind: "tool-call";
      tool: string | null;
      argument: string | null;
      status: "running" | "done" | "failed";
      durationMs: number | null;
    }
  | { kind: "agent-message"; to: MonitorAgent | null }
  | { kind: "agent-status"; status: MonitorAgentStatus; error: string | null }
);

function entryTone(event: MonitorEvent): MonitorStatus | null {
  switch (event.kind) {
    case "task":
      if (event.state === "failed") return "error";
      return event.state === "completed" ? "done" : null;
    case "tool-call":
      if (event.status === "failed") return "error";
      return event.status === "done" ? "done" : null;
    case "agent-status":
      return event.status === "error" ? "error" : null;
    default:
      return null;
  }
}

/** The events of a snapshot, newest first, with the agents, tasks and tool calls they name. */
export function buildMonitorFeed(snapshot: MonitorSnapshot): MonitorFeedEntry[] {
  const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const toolCalls = new Map(snapshot.toolCalls.map((call) => [call.id, call]));
  const agentOf = (id: string | null) => (id === null ? null : (agents.get(id) ?? null));
  return [...snapshot.events]
    .sort((left, right) => right.at.localeCompare(left.at))
    .map((event): MonitorFeedEntry => {
      const base = { id: event.id, at: event.at, agent: agentOf(event.agentId), tone: entryTone(event) };
      switch (event.kind) {
        case "message":
          return {
            ...base,
            kind: "message",
            authorKind: event.authorKind,
            preview: markdownPreviewText(event.preview),
          };
        case "task": {
          const task = tasks.get(event.taskId);
          const agent = base.agent;
          return {
            ...base,
            kind: "task",
            state: event.state,
            title: task?.title ?? null,
            error: event.state === "failed" ? (task?.error ?? null) : null,
            step:
              event.state === "running" && agent?.currentTaskId === event.taskId && agent.status === "working"
                ? agent.step
                : null,
          };
        }
        case "tool-call": {
          const call = toolCalls.get(event.toolCallId);
          return {
            ...base,
            kind: "tool-call",
            tool: call?.tool ?? null,
            argument: call?.argument ?? null,
            status: event.status,
            durationMs: call?.durationMs ?? null,
          };
        }
        case "agent-message":
          return { ...base, agent: agentOf(event.fromAgentId), kind: "agent-message", to: agentOf(event.toAgentId) };
        case "agent-status":
          return {
            ...base,
            kind: "agent-status",
            status: event.status,
            error: event.status === "error" ? (base.agent?.error ?? null) : null,
          };
        default:
          return event satisfies never;
      }
    });
}
