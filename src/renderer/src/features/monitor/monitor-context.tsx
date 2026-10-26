import type { MonitorAgentStatus, MonitorSnapshot } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { MonitorChannelTab } from "@openbot/ui/features/monitor/MonitorChannelHeader";
import { createEffect, createMemo, createStore, onCleanup } from "solid-js";
import { createSimpleContext } from "../../simple-context";
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
import { countNewMonitorEvents } from "./monitor-feed";
import type { MonitorSource } from "./monitor-port";
import type { MonitorTaskFilter } from "./monitor-tasks";

/** What the main area of the Monitor shows: one channel, or every agent. */
export type MonitorView = "channel" | "all-agents";

interface MonitorState {
  channelId: string | null;
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
  /** The agent the user selected in the sidebar or on the canvas. The agent popup (#25) shows it. */
  selectedAgentId: string | null;
  /** The view of the open channel. */
  tab: MonitorChannelTab;
  /** The filter chip of the Tasks view. */
  taskFilter: MonitorTaskFilter;
  /** The two agents whose conversation the drawer (#27) shows, from a line label of the canvas. */
  conversation: [string, string] | null;
  /** The sidebar part of the newest snapshot of each listed channel, by channel id. */
  overview: Record<string, MonitorChannelOverview>;
}

export interface MonitorProviderProps {
  source: MonitorSource;
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
      tab: "canvas",
      taskFilter: "all",
      conversation: null,
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
        setState((draft) => {
          draft.selectedAgentId = agentId;
          if (home !== null && draft.view === "channel") draft.pickedChannelId = home;
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
          draft.conversation = agentIds;
        });
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
