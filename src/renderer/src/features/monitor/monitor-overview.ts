import type { MonitorAgent, MonitorAgentStatus, MonitorSnapshot } from "@openbot/contracts/ipc";

/** One agent of a channel, as the Monitor sidebar shows it. */
export interface MonitorOverviewAgent {
  id: string;
  name: string;
  avatarSeed: string;
  avatarHue: MonitorAgent["avatarHue"];
  avatarUrl: string | null;
  status: MonitorAgentStatus;
  /** Its task title, or its error when the status is `error`. */
  detail: string | null;
  /** When the status started, as an ISO time. */
  since: string | null;
  /** The channel the entry comes from. The All agents view shows it on the card. */
  channelId: string;
  channelName: string;
  /** The channel lead. The card shows the lead role in place of the provider. */
  lead: boolean;
  provider: MonitorAgent["provider"];
}

/** What the sidebar keeps of the snapshot of one channel. */
export interface MonitorChannelOverview {
  generatedAt: string;
  agents: MonitorOverviewAgent[];
}

/** The newest time of an event of the agent, of a status event when `statusOnly`. */
function lastEventAt(snapshot: MonitorSnapshot, agentId: string, statusOnly: boolean): string | null {
  let newest: string | null = null;
  for (const event of snapshot.events) {
    if (event.agentId !== agentId || (statusOnly && event.kind !== "agent-status")) continue;
    if (newest === null || Date.parse(event.at) > Date.parse(newest)) newest = event.at;
  }
  return newest;
}

/** The part of a snapshot that the sidebar shows: each agent with its status line. */
export function summarizeMonitorSnapshot(snapshot: MonitorSnapshot): MonitorChannelOverview {
  const titles = new Map(snapshot.tasks.map((task) => [task.id, task.title]));
  return {
    generatedAt: snapshot.generatedAt,
    agents: snapshot.agents.map((agent) => {
      const task = agent.currentTaskId ? (titles.get(agent.currentTaskId) ?? null) : null;
      const statusAt = lastEventAt(snapshot, agent.id, true);
      const since =
        agent.status === "working"
          ? (agent.startedAt ?? statusAt)
          : agent.status === "idle"
            ? lastEventAt(snapshot, agent.id, false)
            : statusAt;
      return {
        id: agent.id,
        name: agent.name,
        avatarSeed: agent.avatarSeed,
        avatarHue: agent.avatarHue,
        avatarUrl: agent.avatarUrl,
        status: agent.status,
        detail: agent.status === "error" ? (agent.error ?? task) : task,
        since,
        channelId: snapshot.channelId,
        channelName: snapshot.channelName,
        lead: agent.lead,
        provider: agent.provider,
      };
    }),
  };
}

/** How many agents of one channel have each status. */
export function countMonitorChannel(overview: MonitorChannelOverview | undefined) {
  const agents = overview?.agents ?? [];
  const count = (status: MonitorAgentStatus) => agents.filter((agent) => agent.status === status).length;
  return { agents: agents.length, working: count("working"), waiting: count("waiting"), errors: count("error") };
}

/**
 * Which status an agent in several channels shows: the one that needs the user first. An error comes
 * before waiting, waiting before working, and working before idle.
 */
const STATUS_RANK = { error: 3, waiting: 2, working: 1, idle: 0 } as const satisfies Record<MonitorAgentStatus, number>;

/** The order of the list, as in the design: working, waiting, error, then idle. */
const LIST_ORDER = { working: 0, waiting: 1, error: 2, idle: 3 } as const satisfies Record<MonitorAgentStatus, number>;

/**
 * Each agent once, over the channels in their order. An agent in several channels shows the status
 * that needs the user first. The list goes by status, then by name.
 */
export function mergeMonitorAgents(overviews: readonly (MonitorChannelOverview | undefined)[]): MonitorOverviewAgent[] {
  const agents = new Map<string, MonitorOverviewAgent>();
  for (const overview of overviews) {
    for (const agent of overview?.agents ?? []) {
      const current = agents.get(agent.id);
      if (!current || STATUS_RANK[agent.status] > STATUS_RANK[current.status]) agents.set(agent.id, agent);
    }
  }
  return [...agents.values()].sort(
    (left, right) => LIST_ORDER[left.status] - LIST_ORDER[right.status] || left.name.localeCompare(right.name),
  );
}

/** The "Live now" counts: how many agents work, wait and have an error. */
export function countLiveAgents(agents: readonly MonitorOverviewAgent[]) {
  const count = (status: MonitorAgentStatus) => agents.filter((agent) => agent.status === status).length;
  return { working: count("working"), waiting: count("waiting"), error: count("error") };
}

/** The newest snapshot time over the channels, or null before the first one. */
export function newestMonitorUpdate(overviews: readonly (MonitorChannelOverview | undefined)[]): string | null {
  let newest: string | null = null;
  for (const overview of overviews) {
    if (!overview) continue;
    if (newest === null || Date.parse(overview.generatedAt) > Date.parse(newest)) newest = overview.generatedAt;
  }
  return newest;
}
