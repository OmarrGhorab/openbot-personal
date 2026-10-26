// The Monitor in the browser client. It builds the same snapshot as main with `buildMonitorSnapshot`,
// from what the connected host serves over the Team API: the channel page, the agents, their tasks
// and the task conversations, plus the live turns it keeps from the host's events. The Team API
// adapters stay as released: this file only calls them.
//
// What the web client cannot see: the host's mailbox (so the agent pairs come only from the exchange
// summaries in the channel page), and the trace of a finished turn (the Team API drops it, so a
// finished tool call is missing; the running ones come from the turn-progress events). The thread of
// a live turn has no channel here, so a member's running turn counts for every channel it is in.

import type { AgentEvent, MonitorChange, MonitorSnapshot, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import {
  buildMonitorSnapshot,
  isTeamRealtimeEvent,
  MonitorLiveState,
  type MonitorTaskTrace,
  redactMonitorSnapshot,
} from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { currentText } from "@openbot/ui/text";
import type { MonitorSource } from "../monitor/monitor-port";
import type { TasksSource } from "../tasks/tasks-port";
import type { WebWorkspaceRuntime } from "./web-runtime";

/** Changes that arrive within this time reach the Monitor as one. A streaming reply sends many events. */
const CHANGE_COALESCE_MS = 200;

export interface WebMonitorDependencies {
  runtime: Pick<WebWorkspaceRuntime, "channels" | "listAgents">;
  tasks: Pick<TasksSource, "list" | "read">;
  /** The connected host, or null while none is. */
  hostId: () => string | null;
  onHostEvent: (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void;
  now?: () => Date;
  redact?: (text: string) => string;
}

export interface WebMonitorSource extends MonitorSource {
  /** Stops the host event subscription and the change timers. */
  dispose(): void;
}

export function webMonitorSource(dependencies: WebMonitorDependencies): WebMonitorSource {
  const now = dependencies.now ?? (() => new Date());
  const redact = dependencies.redact ?? redactText;
  /** The thread of each agent task the last read saw, so a live turn knows its task. */
  const taskThreads = new Map<string, string>();
  const threadKey = (agentId: string, threadId: string) => `${agentId}\n${threadId}`;
  const live = new MonitorLiveState({
    channelForThread: () => null,
    taskIdForThread: (agentId, threadId) => taskThreads.get(threadKey(agentId, threadId)) ?? null,
  });
  /** The channels the Monitor read, with their members at that read, and their revision. */
  const watched = new Map<string, { members: Set<string>; revision: number }>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<(change: MonitorChange) => void>();
  let host = dependencies.hostId();

  function changed(channelId: string) {
    if (!watched.has(channelId) || pending.has(channelId)) return;
    pending.set(
      channelId,
      setTimeout(() => {
        pending.delete(channelId);
        const current = watched.get(channelId);
        if (!current) return;
        current.revision += 1;
        const change = { channelId, revision: current.revision };
        for (const listener of listeners) listener(change);
      }, CHANGE_COALESCE_MS),
    );
  }

  function changedForAgent(agentId: string, channelId: string | null) {
    for (const [watchedId, entry] of watched) {
      if (entry.members.has(agentId) && (channelId === null || channelId === watchedId)) changed(watchedId);
    }
  }

  function changedAll() {
    for (const channelId of watched.keys()) changed(channelId);
  }

  const unsubscribe = dependencies.onHostEvent((event) => {
    if (isTeamRealtimeEvent(event)) return;
    // Another host, or the same host after a reconnect: the turns that ran before are unknown now.
    const current = dependencies.hostId();
    if (current !== host || event.type === "runtime-snapshot") {
      host = current;
      live.clear();
      taskThreads.clear();
      changedAll();
      if (event.type === "runtime-snapshot") return;
    }
    const change = live.observe(event, now().toISOString());
    if (!change) return;
    if (change.kind === "agent") changedForAgent(change.agentId, change.channelId);
    else if (change.kind === "channel") changed(change.channelId);
    else changedAll();
  });

  async function snapshot(channelId: string): Promise<MonitorSnapshot> {
    const hostId = dependencies.hostId();
    const channels = dependencies.runtime.channels;
    if (hostId === null || !channels) throw new Error(currentText().t("webClient.error.desktopOnly"));
    const [page, agents] = await Promise.all([channels.readChannel({ channelId }), dependencies.runtime.listAgents()]);
    const members = new Set(page.channel.members.map((member) => member.agentId));
    const lists = await Promise.all([...members].map((agentId) => dependencies.tasks.list(agentId, hostId)));
    const agentTasks = lists.flatMap((list) => list.tasks);
    for (const task of agentTasks) taskThreads.set(threadKey(task.agentId, task.threadId), task.id);
    // The open tasks only: a closed task's tool calls are old news for a live view.
    const taskTraces: MonitorTaskTrace[] = await Promise.all(
      agentTasks
        .filter((task) => task.state !== "closed")
        .map(async (task) => ({
          agentId: task.agentId,
          taskId: task.id,
          messages: (await dependencies.tasks.read({ agentId: task.agentId, taskId: task.id }, hostId)).messages,
        })),
    );
    const entry = watched.get(channelId);
    const revision = entry?.revision ?? 0;
    watched.set(channelId, { members, revision });
    const built = buildMonitorSnapshot({
      generatedAt: now().toISOString(),
      revision,
      page,
      agents,
      agentTasks,
      taskTraces,
      liveTurns: live.turns(members, channelId),
      exchanges: [],
      attention: live.attention(members),
    });
    // As in main: no view reads tool-call text or an error before it is redacted.
    return redactMonitorSnapshot(built, redact);
  }

  return {
    snapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribe();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      listeners.clear();
    },
  };
}
