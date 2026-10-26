import type { MonitorAgentStatus, MonitorSnapshot, MonitorTask } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { MonitorChannelTab } from "@openbot/ui/features/monitor/MonitorChannelHeader";
import { createEffect, createMemo, createStore, onCleanup } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { countNewMonitorEvents } from "./monitor-feed";
import {
  EMPTY_MONITOR_FILTERS,
  filterMonitorSnapshot,
  MONITOR_AGENT_STATUS_LABEL,
  MONITOR_FILTER_LABEL,
  MONITOR_TOOL_STATUS_LABEL,
  type MonitorFilters,
} from "./monitor-filters";
import {
  countLiveAgents,
  type MonitorChannelOverview,
  mergeMonitorAgents,
  newestMonitorUpdate,
  summarizeMonitorSnapshot,
} from "./monitor-overview";
import type { MonitorActions, MonitorSource, MonitorTaskTarget } from "./monitor-port";
import type { MonitorTaskFilter } from "./monitor-tasks";

/** What the main area of the Monitor shows: one channel, or every agent. */
export type MonitorView = "channel" | "all-agents";

interface MonitorState {
  channelId: string | null;
  /** The members popover of the channel header is open. */
  membersOpen: boolean;
  /** The add-agent dialog is open. */
  addAgentOpen: boolean;
  /**
   * The snapshot of `channelId` that the views show, unfiltered: the newest one, or while the feed
   * is paused, the one from the moment of the pause.
   */
  snapshot: MonitorSnapshot | null;
  /** Pause feed: the views keep `snapshot` and do not change. The agents keep working. */
  paused: boolean;
  /** The newest snapshot read while the feed is paused. Resume shows it. */
  pending: MonitorSnapshot | null;
  loading: boolean;
  /** Set when the last read failed. The previous snapshot stays. */
  error: AppTextKey | null;
  filters: MonitorFilters;
  view: MonitorView;
  /** The channel the user picked. Null opens the first channel. */
  pickedChannelId: string | null;
  /** The agent the user selected in the sidebar, on the canvas or in the Tasks view. The agent popup shows it. */
  selectedAgentId: string | null;
  /** The agent whose thread "Open thread" opened. Its thread shows "Back to monitor". */
  threadAgentId: string | null;
  /** The view of the open channel. */
  tab: MonitorChannelTab;
  /** The filter chip of the Tasks view. */
  taskFilter: MonitorTaskFilter;
  /** The two agents whose conversation the drawer (#27) shows, from a line label of the canvas. */
  conversation: [string, string] | null;
  /** The agent whose tool calls the "Tool calls" view lists (#26). Null when it is closed. */
  toolCallsAgentId: string | null;
  /** The sidebar part of the newest snapshot of each listed channel, by channel id. */
  overview: Record<string, MonitorChannelOverview>;
}

export interface MonitorProviderProps {
  source: MonitorSource;
  /** The task actions of the agent popup, and the move to and from a thread. */
  actions: MonitorActions;
  /** Whether the Monitor page is on screen. It reads nothing while it is not. */
  active: () => boolean;
  /** The channels the Monitor lists, in the order of the sidebar. */
  channelIds: () => readonly string[];
}

const context = createSimpleContext({
  name: "MonitorProvider",
  init: (props: MonitorProviderProps) => {
    const [state, setState] = createStore<MonitorState>({
      channelId: null,
      snapshot: null,
      paused: false,
      pending: null,
      loading: false,
      error: null,
      filters: { ...EMPTY_MONITOR_FILTERS },
      view: "channel",
      pickedChannelId: null,
      selectedAgentId: null,
      threadAgentId: null,
      tab: "canvas",
      taskFilter: "all",
      conversation: null,
      toolCallsAgentId: null,
      membersOpen: false,
      addAgentOpen: false,
      overview: {},
    });
    /** Counts reads, so a slow read of an older channel or revision cannot replace a newer one. */
    let generation = 0;
    /** The same, for each channel of the sidebar. */
    const overviewGenerations = new Map<string, number>();

    function keepOverview(snapshot: MonitorSnapshot) {
      const overview = summarizeMonitorSnapshot(snapshot);
      setState((draft) => {
        draft.overview[snapshot.channelId] = overview;
      });
    }

    async function load(channelId: string, minimumRevision = 0) {
      generation += 1;
      const read = generation;
      setState((draft) => {
        draft.loading = true;
      });
      try {
        const snapshot = await props.source.snapshot(channelId);
        if (read !== generation || snapshot.revision < minimumRevision) return;
        setState((draft) => {
          draft.loading = false;
          draft.error = null;
          // While paused, the view keeps its snapshot and the read waits. A newer read replaces the
          // waiting one, so Resume applies every event once.
          if (draft.paused && draft.snapshot) draft.pending = snapshot;
          else draft.snapshot = snapshot;
        });
        keepOverview(snapshot);
      } catch {
        if (read !== generation) return;
        setState((draft) => {
          draft.loading = false;
          draft.error = "monitor.error.load";
        });
      }
    }

    /** Reads the sidebar part of one channel. A failed read keeps the previous counts. */
    async function loadOverview(channelId: string) {
      const read = (overviewGenerations.get(channelId) ?? 0) + 1;
      overviewGenerations.set(channelId, read);
      try {
        const snapshot = await props.source.snapshot(channelId);
        if (overviewGenerations.get(channelId) !== read) return;
        keepOverview(snapshot);
      } catch {
        // The sidebar keeps the counts it has; the open channel shows the error.
      }
    }

    /** The channel on screen: the one the user picked while it is listed, else the first one. */
    const channelId = createMemo(() => {
      if (!props.active()) return null;
      const ids = props.channelIds();
      const picked = state.pickedChannelId;
      return picked !== null && ids.includes(picked) ? picked : (ids[0] ?? null);
    });

    // The Monitor is on screen again: the thread that it opened is behind it.
    createEffect(props.active, (active) => {
      if (!active) return;
      setState((draft) => {
        draft.threadAgentId = null;
      });
    });

    createEffect(channelId, (id) => {
      setState((draft) => {
        draft.channelId = id;
        draft.snapshot = null;
        // Leaving the channel ends a pause: the next channel, or this one again, opens live.
        draft.paused = false;
        draft.pending = null;
        draft.error = null;
        draft.filters = { ...EMPTY_MONITOR_FILTERS };
        draft.conversation = null;
        draft.toolCallsAgentId = null;
        draft.membersOpen = false;
        draft.addAgentOpen = false;
      });
      if (id === null) return;
      void load(id);
    });

    // The sidebar counts of every listed channel, while the page is on screen. One subscription
    // reads a channel again when it changed; the open channel reads its full snapshot instead.
    createEffect(
      () => (props.active() ? props.channelIds().join("\n") : null),
      (joined) => {
        if (joined === null) return;
        const ids = joined === "" ? [] : joined.split("\n");
        const listed = new Set(ids);
        setState((draft) => {
          for (const id of Object.keys(draft.overview)) if (!listed.has(id)) delete draft.overview[id];
        });
        for (const id of ids) if (id !== channelId()) void loadOverview(id);
        return props.source.onChange((change) => {
          if (!listed.has(change.channelId)) return;
          if (change.channelId === state.channelId) void load(change.channelId, change.revision);
          else void loadOverview(change.channelId);
        });
      },
    );
    onCleanup(() => overviewGenerations.clear());

    /** The snapshot with the filters applied. Null before the first read. */
    const filtered = createMemo(() => (state.snapshot ? filterMonitorSnapshot(state.snapshot, state.filters) : null));
    const listedOverviews = () => props.channelIds().map((id) => state.overview[id]);
    /** Each agent of the listed channels once, for the sidebar. */
    const agents = createMemo(() => mergeMonitorAgents(listedOverviews()));
    /** The "Live now" counts. They follow every new snapshot. */
    const liveCounts = createMemo(() => countLiveAgents(agents()));
    const updatedAt = createMemo(() => newestMonitorUpdate(listedOverviews()));
    /** The status that the "Live now" filter shows, when the filter is one status alone. */
    /** The events of the newest read that the paused view does not show yet. */
    const waitingEvents = createMemo(() =>
      state.paused && state.snapshot && state.pending ? countNewMonitorEvents(state.snapshot, state.pending) : 0,
    );
    /** Where a task of the open channel is stopped or resumed. */
    function taskTarget(task: MonitorTask): MonitorTaskTarget | null {
      if (task.source === "agent") {
        return task.agentId === null ? null : { source: "agent", agentId: task.agentId, taskId: task.id };
      }
      const channel = state.channelId;
      return channel === null ? null : { source: "channel", channelId: channel, taskId: task.id };
    }
    const statusFilter = () => (state.filters.agentStatuses.length === 1 ? state.filters.agentStatuses[0] : null);

    return {
      state,
      filtered,
      agents,
      liveCounts,
      updatedAt,
      statusFilter,
      waitingEvents,
      /** The catalog keys of the statuses and filter choices that every Monitor view shows. */
      labels: {
        agentStatus: MONITOR_AGENT_STATUS_LABEL,
        toolStatus: MONITOR_TOOL_STATUS_LABEL,
        filter: MONITOR_FILTER_LABEL,
      },
      setFilters(change: Partial<MonitorFilters>) {
        setState((draft) => {
          draft.filters = { ...draft.filters, ...change };
        });
      },
      clearFilters() {
        setState((draft) => {
          draft.filters = { ...EMPTY_MONITOR_FILTERS };
        });
      },
      /** Shows only the agents with `status`, or removes that filter when it is on. */
      toggleStatusFilter(status: MonitorAgentStatus) {
        setState((draft) => {
          const on = draft.filters.agentStatuses.length === 1 && draft.filters.agentStatuses[0] === status;
          draft.filters = { ...draft.filters, agentStatuses: on ? [] : [status] };
        });
      },
      /** Opens a channel in the Monitor. */
      selectChannel(id: string) {
        setState((draft) => {
          draft.pickedChannelId = id;
          draft.view = "channel";
        });
      },
      /** Opens the all-agents view. */
      showAllAgents() {
        setState((draft) => {
          draft.view = "all-agents";
        });
      },
      /**
       * Selects an agent for the agent popup. When the open channel does not have the agent, the
       * first listed channel that has it opens.
       */
      selectAgent(agentId: string) {
        const hasAgent = (id: string) => state.overview[id]?.agents.some((agent) => agent.id === agentId) === true;
        const open = state.channelId;
        const home = open !== null && hasAgent(open) ? open : (props.channelIds().find(hasAgent) ?? null);
        // The popup reads the snapshot of the open channel, so the agent's channel opens in the
        // all-agents view too. The view stays.
        setState((draft) => {
          draft.selectedAgentId = agentId;
          if (home !== null) draft.pickedChannelId = home;
        });
      },
      /** Shows the canvas, the feed or the tasks of the open channel. */
      setTab(tab: MonitorChannelTab) {
        setState((draft) => {
          draft.tab = tab;
        });
      },
      /** Shows the tasks of one chip in the Tasks view. */
      setTaskFilter(filter: MonitorTaskFilter) {
        setState((draft) => {
          draft.taskFilter = filter;
        });
      },
      /** Opens the conversation between two agents of the open channel. */
      openConversation(agentIds: [string, string]) {
        setState((draft) => {
          draft.selectedAgentId = null;
          draft.conversation = agentIds;
        });
      },
      /** Reads the messages between two agents of the open channel. Rejects when the host refuses. */
      loadConversation(agentIds: [string, string]) {
        const channelId = state.channelId;
        if (channelId === null) return Promise.reject(new Error("No channel is open."));
        return props.source.conversation({ channelId, agentIds });
      },
      /** Closes the conversation. */
      closeConversation() {
        setState((draft) => {
          draft.conversation = null;
        });
      },
      /** Closes the agent selection. */
      clearAgent() {
        setState((draft) => {
          draft.selectedAgentId = null;
        });
      },
      /** Opens the tool calls of an agent's task. The agent popup closes: the list replaces it. */
      openToolCalls(agentId: string) {
        setState((draft) => {
          draft.selectedAgentId = null;
          draft.toolCallsAgentId = agentId;
        });
      },
      /** Closes the tool calls. */
      closeToolCalls() {
        setState((draft) => {
          draft.toolCallsAgentId = null;
        });
      },
      /** Opens the members popover of the channel header. */
      openMembers() {
        setState((draft) => {
          draft.membersOpen = true;
        });
      },
      /** Closes the members popover. */
      closeMembers() {
        setState((draft) => {
          draft.membersOpen = false;
        });
      },
      /** Opens the add-agent dialog. The members popover closes. */
      openAddAgent() {
        setState((draft) => {
          draft.membersOpen = false;
          draft.addAgentOpen = true;
        });
      },
      /** Closes the add-agent dialog. */
      closeAddAgent() {
        setState((draft) => {
          draft.addAgentOpen = false;
        });
      },
      /** Opens the thread of the agent in place of the Monitor. Its thread shows "Back to monitor". */
      openThread(agentId: string) {
        setState((draft) => {
          draft.selectedAgentId = null;
          draft.toolCallsAgentId = null;
          draft.conversation = null;
          draft.threadAgentId = agentId;
        });
        props.actions.openThread(agentId);
      },
      /** Opens the routines view in place of the Monitor. */
      openRoutines() {
        props.actions.openRoutines?.();
      },
      /** "Back to monitor": shows the Monitor with the channel and view it had. */
      returnToMonitor() {
        setState((draft) => {
          draft.threadAgentId = null;
        });
        props.actions.showMonitor();
      },
      /**
       * Stops a task of the open channel. The agent keeps its workspace, thread and identity. The next
       * snapshot shows the change. Rejects when the host refuses.
       */
      async stopTask(task: MonitorTask): Promise<void> {
        const target = taskTarget(task);
        if (!target) throw new Error("The task has no owner to stop it.");
        await props.actions.stopTask(target);
      },
      /** Holds the queue of an agent task. Rejects when the task is not an agent task or the host refuses. */
      async pauseTask(task: MonitorTask): Promise<void> {
        const target = taskTarget(task);
        if (target?.source !== "agent") throw new Error("Only an agent task can pause.");
        await props.actions.pauseTask(target);
      },
      /** Continues a held task of either source. Rejects when the host refuses. */
      async resumeTask(task: MonitorTask): Promise<void> {
        const target = taskTarget(task);
        if (target === null) throw new Error("The task has no owner to resume it.");
        await props.actions.resumeTask(target);
      },
      /** Pause feed: the views stop changing. New reads wait until `resumeFeed`. */
      pauseFeed() {
        setState((draft) => {
          draft.paused = true;
        });
      },
      /** Resume feed: the views show the newest read, with every event that waited. */
      resumeFeed() {
        setState((draft) => {
          if (draft.pending) draft.snapshot = draft.pending;
          draft.pending = null;
          draft.paused = false;
        });
      },
      reload() {
        const id = state.channelId;
        if (id !== null) void load(id);
      },
    };
  },
});

export const MonitorProvider = context.provider;
export const useMonitor = context.use;
