import type {
  MonitorAgent,
  MonitorSnapshot,
  MonitorTask,
  MonitorTaskState,
  MonitorToolCall,
} from "@openbot/contracts/ipc";

/** The task states that Stop ends: the task runs, waits, or waits in the queue. */
const STOPPABLE: readonly MonitorTaskState[] = ["queued", "running", "waiting"];

/** The task states that Pause holds: a live task that is not paused yet. */
const PAUSABLE: readonly MonitorTaskState[] = ["queued", "running", "waiting"];

/** The longest task title. The full text shows under it. */
const TITLE_LIMIT = 80;

/** What the agent popup shows for one agent of the open channel. */
export interface MonitorAgentPopupModel {
  agent: MonitorAgent;
  /**
   * The task the popup shows: the agent's current task, else a channel task of the agent that Stop
   * held. Null: the agent works on no task.
   */
  task: MonitorTask | null;
  /** The task runs or waits, so Stop applies. */
  stoppable: boolean;
  /** A paused task, of either source. Resume continues it. */
  resumable: boolean;
  /** An agent task that runs or waits and is not paused. Pause holds its queue; the running turn ends. */
  pausable: boolean;
  /** The tool calls of the task, or of the agent when it has no task. Newest first. */
  toolCalls: MonitorToolCall[];
  /** The agents this agent exchanged messages with, the most messages first. */
  contacts: { agent: MonitorAgent; count: number }[];
}

/**
 * The popup model of one agent, from the snapshot of its channel. Null when the snapshot does not
 * have the agent, such as while the channel of the agent loads.
 */
export function buildMonitorAgentPopup(snapshot: MonitorSnapshot, agentId: string): MonitorAgentPopupModel | null {
  const agent = snapshot.agents.find((entry) => entry.id === agentId);
  if (!agent) return null;
  const current = agent.currentTaskId ? (snapshot.tasks.find((task) => task.id === agent.currentTaskId) ?? null) : null;
  const held =
    current === null
      ? (snapshot.tasks.find((task) => task.agentId === agentId && task.state === "paused") ?? null)
      : null;
  const task = current ?? held;

  const ownCalls = snapshot.toolCalls.filter((call) => call.agentId === agentId);
  // A live turn in a member thread does not know its channel task, so its calls have no task id.
  // They belong to the current task when they started in the running turn.
  const startedAt = agent.startedAt;
  const toolCalls = task
    ? ownCalls.filter(
        (call) =>
          call.taskId === task.id ||
          (task === current && call.taskId === null && startedAt !== null && call.startedAt >= startedAt),
      )
    : ownCalls;

  const byId = new Map(snapshot.agents.map((entry) => [entry.id, entry]));
  const contacts = snapshot.pairs
    .flatMap((pair) => {
      if (!pair.agentIds.includes(agentId)) return [];
      const otherId = pair.agentIds[0] === agentId ? pair.agentIds[1] : pair.agentIds[0];
      const other = byId.get(otherId);
      return other ? [{ agent: other, count: pair.count }] : [];
    })
    .sort((left, right) => right.count - left.count || left.agent.name.localeCompare(right.agent.name));

  return {
    agent,
    task,
    stoppable: task !== null && STOPPABLE.includes(task.state),
    resumable: task !== null && task.state === "paused",
    pausable: task !== null && task.source === "agent" && PAUSABLE.includes(task.state),
    toolCalls,
    contacts,
  };
}

/**
 * The title and the full text of a task. A task is one instruction, so the title is its first line,
 * cut at a word. The text shows only when it says more than the title.
 */
export function splitMonitorTaskTitle(instruction: string): { title: string; text: string | null } {
  const full = instruction.trim();
  const firstLine = full.split(/\r?\n/u)[0]?.trim() ?? "";
  let title = firstLine;
  if (title.length > TITLE_LIMIT) {
    const cut = title.slice(0, TITLE_LIMIT);
    const space = cut.lastIndexOf(" ");
    title = `${(space > TITLE_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return { title, text: title === full ? null : full };
}
