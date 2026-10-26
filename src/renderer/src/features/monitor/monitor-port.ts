import type { ChannelCommand, MonitorChange, MonitorSnapshot } from "@openbot/contracts/ipc";

/** What the Monitor reads: the snapshot of one channel, and the change that asks for a new read. */
export interface MonitorSource {
  snapshot(channelId: string): Promise<MonitorSnapshot>;
  /** Calls `listener` when the snapshot of a channel changed. Returns the unsubscribe. */
  onChange(listener: (change: MonitorChange) => void): () => void;
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
  /** Continues a channel task that Stop held, with the channel `resume` command. */
  resumeTask(target: Extract<MonitorTaskTarget, { source: "channel" }>): Promise<void>;
}

/** What the Monitor does outside its page: the task actions, and the move to and from a thread. */
export interface MonitorActions extends MonitorTaskActions {
  /** Shows the thread of the agent, in place of the Monitor. */
  openThread(agentId: string): void;
  /** Shows the Monitor again. */
  showMonitor(): void;
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
    async resumeTask(target) {
      await window.openbot.agent.channelCommand(monitorChannelTaskCommand("resume", target));
    },
  };
}
