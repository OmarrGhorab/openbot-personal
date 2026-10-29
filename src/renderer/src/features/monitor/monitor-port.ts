import type {
  ChannelCommand,
  MonitorChange,
  MonitorConversation,
  MonitorConversationInput,
  MonitorSnapshot,
  RavenTeamJob,
} from "@openbot/contracts/ipc";

/** What the Monitor reads: the snapshot of one channel, and the change that asks for a new read. */
export interface MonitorSource {
  snapshot(channelId: string): Promise<MonitorSnapshot>;
  /** The messages between two agents of a channel, oldest first. */
  conversation(input: MonitorConversationInput): Promise<MonitorConversation>;
  /** Calls `listener` when the snapshot of a channel changed. Returns the unsubscribe. */
  onChange(listener: (change: MonitorChange) => void): () => void;
}

/**
 * What the Monitor reads of the Raven Stack team jobs of this computer. It only reads: the team page
 * starts and stops jobs.
 */
export interface MonitorTeamSource {
  listJobs(): Promise<RavenTeamJob[]>;
  /**
   * Calls `listener` when a team job changed, or when a turn of an agent started or ended. `threadId`
   * is the work thread of the turn, or null for a job change. Returns the unsubscribe.
   */
  onChange(listener: (change: { threadId: string | null }) => void): () => void;
}

/**
 * A task that the agent popup stops or resumes. An agent task runs beside the agent's own chat; a
 * channel task belongs to the channel coordinator.
 */
export type MonitorTaskTarget =
  | { source: "agent"; agentId: string; taskId: string }
  | { source: "channel"; channelId: string; taskId: string };

/** The task actions of the agent popup, on the host that the Monitor reads. */
export interface MonitorTaskActions {
  /**
   * Stops the task: an agent task with `agent.stopTask`, a channel task with the channel `stop`
   * command, which holds its run. The agent keeps its workspace, thread and identity.
   */
  stopTask(target: MonitorTaskTarget): Promise<void>;
  /**
   * Holds the queue of an agent task with `agent.pauseTask`. The running turn ends first, and the
   * next queued message waits. The agent keeps its workspace, thread and identity.
   */
  // Optional: a host that cannot hold an agent task leaves it out, and the popup hides Pause.
  pauseTask?(target: Extract<MonitorTaskTarget, { source: "agent" }>): Promise<void>;
  /** Continues a held task: an agent task with `agent.resumeTask`, a channel task with the channel `resume` command. */
  resumeTask(target: MonitorTaskTarget): Promise<void>;
}

/** What the Monitor does outside its page: the task actions, and the move to and from a thread. */
export interface MonitorActions extends MonitorTaskActions {
  /** Shows the thread of the agent, in place of the Monitor. */
  openThread(agentId: string): void;
  /** Shows the Monitor again. */
  showMonitor(): void;
  /** Opens the routines view in place of the Monitor. Optional: a host without it leaves the button inert. */
  openRoutines?: (() => void) | undefined;
  /** Shows one work thread of the agent, in place of the Monitor. Optional: a host without team jobs leaves it out. */
  openWorkThread?: ((agentId: string, taskId: string) => void) | undefined;
  /** Opens the team page on a team job. Optional: a host without team jobs leaves it out. */
  openTeamJob?: ((jobId: string) => void) | undefined;
}

/** The channel command that holds or continues a channel task and the run below it. */
export function monitorChannelTaskCommand(
  type: "stop" | "resume",
  target: Extract<MonitorTaskTarget, { source: "channel" }>,
): ChannelCommand {
  return {
    type,
    operationId: crypto.randomUUID(),
    channelId: target.channelId,
    taskId: target.taskId,
    recipientAgentId: null,
  };
}

/**
 * The Monitor on desktop: main builds and redacts the snapshot of a local channel. Read on each call:
 * tests and stories replace `window.openbot` per case.
 */
export function desktopMonitorSource(): MonitorSource {
  return {
    snapshot: (channelId) => window.openbot.monitor.getSnapshot({ channelId }),
    conversation: (input) => window.openbot.monitor.getConversation(input),
    onChange: (listener) => window.openbot.monitor.onChanged(listener),
  };
}

/** The task actions on desktop, on this computer: the Monitor reads local channels only. */
export function desktopMonitorTaskActions(): MonitorTaskActions {
  return {
    async stopTask(target) {
      if (target.source === "agent") {
        await window.openbot.agent.stopTask({ agentId: target.agentId, taskId: target.taskId });
        return;
      }
      await window.openbot.agent.channelCommand(monitorChannelTaskCommand("stop", target));
    },
    async pauseTask(target) {
      await window.openbot.agent.pauseTask({ agentId: target.agentId, taskId: target.taskId });
    },
    async resumeTask(target) {
      if (target.source === "agent") {
        await window.openbot.agent.resumeTask({ agentId: target.agentId, taskId: target.taskId });
        return;
      }
      await window.openbot.agent.channelCommand(monitorChannelTaskCommand("resume", target));
    },
  };
}

/**
 * The team jobs on desktop. A team runs on this computer, so the jobs come from the local team bridge.
 * The `ravenTeam` change event and the agent turn events ask for a new read; nothing polls.
 */
export function desktopMonitorTeamSource(): MonitorTeamSource {
  return {
    listJobs: () => window.openbot.ravenTeam.listJobs(),
    onChange(listener) {
      const offTeam = window.openbot.ravenTeam.onChanged((change) => {
        if (change.jobId !== null) listener({ threadId: null });
      });
      const offTurns = window.openbot.agent.onScopedEvent(({ event }) => {
        if (event.type === "turn-started" || event.type === "turn-completed") listener({ threadId: event.threadId });
      });
      return () => {
        offTeam();
        offTurns();
      };
    },
  };
}
