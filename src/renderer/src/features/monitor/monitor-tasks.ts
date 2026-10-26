import type { MonitorAgent, MonitorSnapshot, MonitorTaskState } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { MonitorStatus } from "@openbot/ui/features/monitor/monitor-status";

/** The filter chips of the Tasks view, in their order. `all` shows every task. */
export const MONITOR_TASK_FILTERS = ["all", "running", "waiting", "error", "done"] as const;
export type MonitorTaskFilter = (typeof MONITOR_TASK_FILTERS)[number];
export type MonitorTaskGroup = Exclude<MonitorTaskFilter, "all">;

export const MONITOR_TASK_FILTER_LABEL = {
  all: "monitor.tasks.filter.all",
  running: "monitor.tasks.filter.running",
  waiting: "monitor.tasks.filter.waiting",
  error: "monitor.tasks.filter.error",
  done: "monitor.tasks.filter.done",
} as const satisfies Record<MonitorTaskFilter, AppTextKey>;

/** The chip a task state counts under. A cancelled task ended, so it is done. */
export const MONITOR_TASK_GROUP = {
  queued: "waiting",
  running: "running",
  waiting: "waiting",
  paused: "waiting",
  completed: "done",
  failed: "error",
  cancelled: "done",
} as const satisfies Record<MonitorTaskState, MonitorTaskGroup>;

/** The colour of a task state. */
const GROUP_STATUS = {
  running: "working",
  waiting: "waiting",
  error: "error",
  done: "done",
} as const satisfies Record<MonitorTaskGroup, MonitorStatus>;

export const MONITOR_TASK_STATE_LABEL = {
  queued: "monitor.taskState.queued",
  running: "monitor.taskState.running",
  waiting: "monitor.taskState.waiting",
  paused: "monitor.taskState.paused",
  completed: "monitor.taskState.completed",
  failed: "monitor.taskState.failed",
  cancelled: "monitor.taskState.cancelled",
} as const satisfies Record<MonitorTaskState, AppTextKey>;

export interface MonitorTaskRow {
  id: string;
  title: string;
  state: MonitorTaskState;
  group: MonitorTaskGroup;
  status: MonitorStatus;
  agent: MonitorAgent | null;
  /** From 0 to 1. Null when the snapshot does not tell how far the task is. */
  progress: number | null;
  /**
   * When the task started: the start of the agent's running turn on it, else its first tool call.
   * Null when the snapshot has neither.
   */
  startedAt: string | null;
  toolCalls: number;
}

function taskProgress(state: MonitorTaskState, agent: MonitorAgent | null, taskId: string): number | null {
  if (state === "completed") return 1;
  const step = agent?.currentTaskId === taskId ? agent.step : null;
  if (!step) return null;
  // The step that runs is not done yet, so step 3 of 5 is 2 steps done of 5.
  return state === "running" ? step.index / step.total : (step.index - 1) / step.total;
}

/** One row per task of the snapshot: running first, then waiting, error and done, in snapshot order. */
export function buildMonitorTaskRows(snapshot: MonitorSnapshot): MonitorTaskRow[] {
  const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const calls = new Map<string, { count: number; first: string }>();
  for (const call of snapshot.toolCalls) {
    if (call.taskId === null) continue;
    const entry = calls.get(call.taskId);
    if (!entry) calls.set(call.taskId, { count: 1, first: call.startedAt });
    else {
      entry.count += 1;
      if (call.startedAt < entry.first) entry.first = call.startedAt;
    }
  }
  const order = MONITOR_TASK_FILTERS.slice(1);
  return snapshot.tasks
    .map((task): MonitorTaskRow => {
      const agent = task.agentId === null ? null : (agents.get(task.agentId) ?? null);
      const group = MONITOR_TASK_GROUP[task.state];
      const turnStart = agent?.currentTaskId === task.id ? agent.startedAt : null;
      const called = calls.get(task.id);
      return {
        id: task.id,
        title: task.title,
        state: task.state,
        group,
        status: GROUP_STATUS[group],
        agent,
        progress: taskProgress(task.state, agent, task.id),
        startedAt: turnStart ?? called?.first ?? null,
        toolCalls: called?.count ?? 0,
      };
    })
    .map((row, index) => ({ row, index }))
    .sort((left, right) => order.indexOf(left.row.group) - order.indexOf(right.row.group) || left.index - right.index)
    .map(({ row }) => row);
}

/** How many rows each chip shows. */
export function countMonitorTaskRows(rows: readonly MonitorTaskRow[]): Record<MonitorTaskFilter, number> {
  const counts: Record<MonitorTaskFilter, number> = { all: rows.length, running: 0, waiting: 0, error: 0, done: 0 };
  for (const row of rows) counts[row.group] += 1;
  return counts;
}
