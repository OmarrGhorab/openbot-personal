import type {
  MonitorAgentStatus,
  MonitorEvent,
  MonitorEventKind,
  MonitorSnapshot,
  MonitorToolCallStatus,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";

/** What the Monitor shows of a snapshot. An empty list means no filter on that field. */
export interface MonitorFilters {
  agentIds: string[];
  agentStatuses: MonitorAgentStatus[];
  toolStatuses: MonitorToolCallStatus[];
  eventKinds: MonitorEventKind[];
}

export const EMPTY_MONITOR_FILTERS: MonitorFilters = {
  agentIds: [],
  agentStatuses: [],
  toolStatuses: [],
  eventKinds: [],
};

export const MONITOR_AGENT_STATUS_LABEL = {
  working: "monitor.agentStatus.working",
  waiting: "monitor.agentStatus.waiting",
  error: "monitor.agentStatus.error",
  idle: "monitor.agentStatus.idle",
} as const satisfies Record<MonitorAgentStatus, AppTextKey>;

export const MONITOR_TOOL_STATUS_LABEL = {
  running: "monitor.toolStatus.running",
  done: "monitor.toolStatus.done",
  failed: "monitor.toolStatus.failed",
} as const satisfies Record<MonitorToolCallStatus, AppTextKey>;

/** The "no filter" choice of each filter menu. */
export const MONITOR_FILTER_LABEL = {
  allAgents: "monitor.filter.allAgents",
  allStatuses: "monitor.filter.allStatuses",
} as const satisfies Record<string, AppTextKey>;

const passes = <T>(selected: readonly T[], value: T) => selected.length === 0 || selected.includes(value);

/** The agents an event is about: its own agent, and both sides of an agent message. */
function eventAgentIds(event: MonitorEvent): string[] {
  if (event.kind === "agent-message") return [event.fromAgentId, event.toAgentId];
  return event.agentId === null ? [] : [event.agentId];
}

/**
 * The part of a snapshot the filters keep. An agent filter also keeps the tasks, tool calls, pairs
 * and events of those agents only; a person's message stays only when no agent is selected.
 */
export function filterMonitorSnapshot(snapshot: MonitorSnapshot, filters: MonitorFilters): MonitorSnapshot {
  const agents = snapshot.agents.filter(
    (agent) => passes(filters.agentIds, agent.id) && passes(filters.agentStatuses, agent.status),
  );
  const kept = new Set(agents.map((agent) => agent.id));
  const agentFiltered = filters.agentIds.length > 0 || filters.agentStatuses.length > 0;
  const keepsAgent = (agentId: string | null) => !agentFiltered || (agentId !== null && kept.has(agentId));
  const toolCalls = snapshot.toolCalls.filter(
    (call) => keepsAgent(call.agentId) && passes(filters.toolStatuses, call.status),
  );
  const toolCallIds = new Set(toolCalls.map((call) => call.id));
  return {
    ...snapshot,
    agents,
    tasks: snapshot.tasks.filter((task) => keepsAgent(task.agentId)),
    toolCalls,
    pairs: snapshot.pairs.filter((pair) => !agentFiltered || pair.agentIds.some((agentId) => kept.has(agentId))),
    events: snapshot.events.filter(
      (event) =>
        passes(filters.eventKinds, event.kind) &&
        (!agentFiltered || eventAgentIds(event).some((agentId) => kept.has(agentId))) &&
        (event.kind !== "tool-call" || toolCallIds.has(event.toolCallId)),
    ),
  };
}

/** The canvas chip of a status filter: "Showing errors · 1 agent". Each status has its own plural. */
export const MONITOR_FILTER_CHIP_LABEL = {
  working: "monitor.filter.showing.working",
  waiting: "monitor.filter.showing.waiting",
  error: "monitor.filter.showing.error",
  idle: "monitor.filter.showing.idle",
} as const;

/**
 * A channel with no activity: no agent works, waits or failed. The canvas shows its empty state,
 * and the header says Idle.
 */
export function monitorChannelIdle(snapshot: MonitorSnapshot): boolean {
  return snapshot.agents.every(
    (agent) => agent.status !== "working" && agent.status !== "waiting" && agent.status !== "error",
  );
}
