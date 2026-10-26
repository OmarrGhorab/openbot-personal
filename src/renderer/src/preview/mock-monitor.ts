import type {
  GroupApi,
  IpcEndpoints,
  MonitorAgentStatus,
  MonitorChange,
  MonitorEvent,
  MonitorSnapshot,
} from "@openbot/contracts/ipc";

type MonitorDesktopApi = GroupApi<IpcEndpoints["monitor"]>;

const minutesAgo = (now: number, minutes: number) => new Date(now - minutes * 60_000).toISOString();

/**
 * One busy channel of five agents: an agent in each status, a task in each state, a tool call in each
 * status, hand-offs over three columns, four agent pairs and a feed event of each kind. Every field of the contract has a value somewhere, so a
 * story of any Monitor view shows real rows.
 */
function mockMonitorSnapshot(channelId: string, now = Date.now()): MonitorSnapshot {
  const at = (minutes: number) => minutesAgo(now, minutes);
  const events: MonitorEvent[] = [
    {
      id: "tool:turn-chief-2:3",
      at: at(1),
      agentId: "chief",
      kind: "tool-call",
      toolCallId: "turn-chief-2:3",
      status: "running",
    },
    {
      id: "exchange:message-4:research",
      at: at(4),
      agentId: "chief",
      kind: "agent-message",
      fromAgentId: "chief",
      toAgentId: "research",
    },
    { id: "status:research:prompt", at: at(5), agentId: "research", kind: "agent-status", status: "waiting" },
    {
      id: "exchange:message-5:developer",
      at: at(3),
      agentId: "designer",
      kind: "agent-message",
      fromAgentId: "designer",
      toAgentId: "developer",
    },
    {
      id: "exchange:message-6:designer",
      at: at(9),
      agentId: "research",
      kind: "agent-message",
      fromAgentId: "research",
      toAgentId: "designer",
    },
    {
      id: "message:message-1",
      at: at(8),
      agentId: null,
      kind: "message",
      messageId: "message-1",
      authorKind: "member",
      preview: "Plan the launch for Friday. Chief leads.",
    },
    {
      id: "message:message-2",
      at: at(7),
      agentId: "chief",
      kind: "message",
      messageId: "message-2",
      authorKind: "agent",
      preview: "I split the work into four tasks.",
    },
    {
      id: "message:message-3",
      at: at(7.5),
      agentId: null,
      kind: "message",
      messageId: "message-3",
      authorKind: "coordinator",
      preview: "Chief took the task.",
    },
    { id: "task:task-logo", at: at(40), agentId: "designer", kind: "task", taskId: "task-logo", state: "completed" },
    { id: "status:sales:error", at: at(11), agentId: "sales", kind: "agent-status", status: "error" },
  ];
  return {
    channelId,
    channelName: "Launch plan",
    revision: 0,
    generatedAt: at(0),
    agents: [
      {
        id: "chief",
        name: "Chief",
        provider: "codex",
        avatarSeed: "chief",
        avatarHue: 245,
        avatarUrl: null,
        lead: true,
        status: "working",
        currentTaskId: "task-plan",
        step: { index: 2, total: 4 },
        startedAt: at(6),
        error: null,
      },
      {
        id: "research",
        name: "Research",
        provider: "claude",
        avatarSeed: "research",
        avatarHue: 185,
        avatarUrl: null,
        lead: false,
        status: "waiting",
        currentTaskId: "task-sources",
        step: null,
        startedAt: null,
        error: null,
      },
      {
        id: "sales",
        name: "Sales Outbound",
        provider: "codex",
        avatarSeed: "sales-outbound",
        avatarHue: 280,
        avatarUrl: null,
        lead: false,
        status: "error",
        currentTaskId: null,
        step: null,
        startedAt: null,
        error: "The provider refused the turn: the usage limit is reached.",
      },
      {
        id: "designer",
        name: "Designer",
        provider: "claude",
        avatarSeed: "designer",
        avatarHue: null,
        avatarUrl: null,
        lead: false,
        status: "idle",
        currentTaskId: null,
        step: null,
        startedAt: null,
        error: null,
      },
      {
        id: "developer",
        name: "Developer",
        provider: "codex",
        avatarSeed: "developer",
        avatarHue: 215,
        avatarUrl: null,
        lead: false,
        status: "working",
        currentTaskId: "task-build",
        step: { index: 3, total: 5 },
        startedAt: at(14),
        error: null,
      },
    ],
    tasks: [
      {
        id: "task-plan",
        source: "channel",
        agentId: "chief",
        parentTaskId: null,
        title: "Write the launch plan and split the work",
        state: "running",
        error: null,
        updatedAt: null,
      },
      {
        id: "task-sources",
        source: "channel",
        agentId: "research",
        parentTaskId: "task-plan",
        title: "Find three competitor launch posts",
        state: "waiting",
        error: null,
        updatedAt: null,
      },
      {
        id: "task-copy",
        source: "channel",
        agentId: null,
        parentTaskId: "task-plan",
        title: "Draft the announcement copy",
        state: "queued",
        error: null,
        updatedAt: null,
      },
      {
        id: "task-leads",
        source: "channel",
        agentId: "sales",
        parentTaskId: "task-build",
        title: "List the first 20 leads",
        state: "failed",
        error: "The provider refused the turn: the usage limit is reached.",
        updatedAt: null,
      },
      {
        id: "task-layouts",
        source: "channel",
        agentId: "designer",
        parentTaskId: "task-plan",
        title: "Draw two layouts for the launch page",
        state: "completed",
        error: null,
        updatedAt: at(20),
      },
      {
        id: "task-build",
        source: "channel",
        agentId: "developer",
        parentTaskId: "task-sources",
        title: "Build the launch page from the chosen layout",
        state: "running",
        error: null,
        updatedAt: at(2),
      },
      {
        id: "task-logo",
        source: "agent",
        agentId: "designer",
        parentTaskId: null,
        title: "Export the logo in three sizes",
        state: "completed",
        error: null,
        updatedAt: at(40),
      },
      {
        id: "task-pricing",
        source: "channel",
        agentId: "chief",
        parentTaskId: null,
        title: "Check the pricing page",
        state: "paused",
        error: null,
        updatedAt: null,
      },
      {
        id: "task-old",
        source: "agent",
        agentId: "research",
        parentTaskId: null,
        title: "Summarize last week's feedback",
        state: "cancelled",
        error: null,
        updatedAt: at(90),
      },
    ],
    toolCalls: [
      {
        id: "turn-chief-2:3",
        agentId: "chief",
        taskId: "task-plan",
        turnId: "turn-chief-2",
        tool: "tool",
        argument: "Gathering the relevant information…",
        input: null,
        output: null,
        status: "running",
        startedAt: at(1),
        endedAt: null,
        durationMs: null,
      },
      {
        id: "turn-chief-2:2",
        agentId: "chief",
        taskId: "task-plan",
        turnId: "turn-chief-2",
        tool: "shell",
        argument: "curl -H 'Authorization: Bearer [redacted]' https://api.example.com/launch",
        input: "curl -H 'Authorization: Bearer [redacted]' https://api.example.com/launch",
        output: '{"status":"ok","items":3}',
        status: "done",
        startedAt: at(3),
        endedAt: at(2.5),
        durationMs: 30_000,
      },
      {
        id: "turn-chief-2:1",
        agentId: "chief",
        taskId: "task-plan",
        turnId: "turn-chief-2",
        tool: "send_message",
        argument: "research, sales",
        input: null,
        output: null,
        status: "done",
        startedAt: at(5),
        endedAt: at(4.9),
        durationMs: 6_000,
      },
      {
        id: "turn-sales-1:1",
        agentId: "sales",
        taskId: "task-leads",
        turnId: "turn-sales-1",
        tool: "shell",
        argument: "bun scripts/export-leads.ts --limit 20",
        input: "bun scripts/export-leads.ts --limit 20",
        output: "error: usage limit reached",
        status: "failed",
        startedAt: at(12),
        endedAt: at(11),
        durationMs: 60_000,
      },
    ],
    pairs: [
      { agentIds: ["chief", "research"], count: 4, lastAt: at(4) },
      { agentIds: ["designer", "research"], count: 9, lastAt: at(9) },
      { agentIds: ["designer", "developer"], count: 14, lastAt: at(3) },
      { agentIds: ["developer", "sales"], count: 2, lastAt: at(10) },
    ],
    events: events.sort((left, right) => right.at.localeCompare(left.at)),
  };
}

/**
 * The agents of each sample after the busy one, with the status each one has there. An agent that is
 * not listed is not a member of that channel.
 */
const QUIET_SAMPLES: readonly Readonly<Record<string, MonitorAgentStatus>>[] = [
  { chief: "idle", designer: "idle", research: "idle" },
  { chief: "idle", designer: "idle", research: "waiting", sales: "idle" },
  { chief: "idle", sales: "error" },
];

/**
 * The sample of a channel: the busy one, or a quieter one, picked from the id so that several channels
 * show different counts and the same channel always shows the same one.
 */
function sampleSnapshot(channelId: string, channelName: string | undefined): MonitorSnapshot {
  const snapshot = mockMonitorSnapshot(channelId);
  if (channelName) snapshot.channelName = channelName;
  let hash = 0;
  for (const character of channelId) hash = (hash + character.charCodeAt(0)) % 4;
  const quiet = hash === 0 ? undefined : QUIET_SAMPLES[hash - 1];
  if (!quiet) return snapshot;
  const kept = (agentId: string | null) => agentId === null || agentId in quiet;
  snapshot.agents = snapshot.agents
    .filter((agent) => agent.id in quiet)
    .map((agent) => {
      const status = quiet[agent.id] ?? "idle";
      return {
        ...agent,
        status,
        currentTaskId: status === "idle" ? null : agent.currentTaskId,
        step: status === "working" ? agent.step : null,
        startedAt: status === "working" ? agent.startedAt : null,
        error: status === "error" ? agent.error : null,
      };
    });
  snapshot.tasks = snapshot.tasks.filter((task) => kept(task.agentId));
  snapshot.toolCalls = snapshot.toolCalls.filter((call) => kept(call.agentId));
  snapshot.pairs = snapshot.pairs.filter((pair) => pair.agentIds.every((agentId) => agentId in quiet));
  snapshot.events = snapshot.events.filter(
    (event) =>
      kept(event.agentId) &&
      (event.kind !== "agent-message" || (event.fromAgentId in quiet && event.toAgentId in quiet)) &&
      (event.kind !== "agent-status" || quiet[event.agentId ?? ""] === event.status),
  );
  return snapshot;
}

/**
 * The preview Monitor. Each channel answers one of four samples under its own id and name: a busy
 * channel, or a quieter one, so the Monitor sidebar shows different counts per channel.
 */
export function createMockMonitor(
  channelName: (channelId: string) => string | undefined = () => undefined,
): MonitorDesktopApi {
  const listeners = new Set<(change: MonitorChange) => void>();
  return {
    getSnapshot: async ({ channelId }) => sampleSnapshot(channelId, channelName(channelId)),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
