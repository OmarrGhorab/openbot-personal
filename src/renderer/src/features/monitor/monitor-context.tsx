import type { MonitorSnapshot } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { createEffect, createMemo, createStore } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import {
  EMPTY_MONITOR_FILTERS,
  filterMonitorSnapshot,
  MONITOR_AGENT_STATUS_LABEL,
  MONITOR_FILTER_LABEL,
  MONITOR_TOOL_STATUS_LABEL,
  type MonitorFilters,
} from "./monitor-filters";
import type { MonitorSource } from "./monitor-port";

interface MonitorState {
  channelId: string | null;
  /** The newest snapshot of `channelId`, unfiltered. */
  snapshot: MonitorSnapshot | null;
  loading: boolean;
  /** Set when the last read failed. The previous snapshot stays. */
  error: AppTextKey | null;
  filters: MonitorFilters;
}

export interface MonitorProviderProps {
  source: MonitorSource;
  /** The channel the Monitor shows. Null shows nothing. */
  channelId: () => string | null;
}

const context = createSimpleContext({
  name: "MonitorProvider",
  init: (props: MonitorProviderProps) => {
    const [state, setState] = createStore<MonitorState>({
      channelId: null,
      snapshot: null,
      loading: false,
      error: null,
      filters: { ...EMPTY_MONITOR_FILTERS },
    });
    /** Counts reads, so a slow read of an older channel or revision cannot replace a newer one. */
    let generation = 0;

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
          draft.snapshot = snapshot;
          draft.loading = false;
          draft.error = null;
        });
      } catch {
        if (read !== generation) return;
        setState((draft) => {
          draft.loading = false;
          draft.error = "monitor.error.load";
        });
      }
    }

    createEffect(props.channelId, (channelId) => {
      setState((draft) => {
        draft.channelId = channelId;
        draft.snapshot = null;
        draft.error = null;
        draft.filters = { ...EMPTY_MONITOR_FILTERS };
      });
      if (channelId === null) return;
      void load(channelId);
      return props.source.onChange((change) => {
        if (change.channelId === channelId) void load(channelId, change.revision);
      });
    });

    /** The snapshot with the filters applied. Null before the first read. */
    const filtered = createMemo(() => (state.snapshot ? filterMonitorSnapshot(state.snapshot, state.filters) : null));

    return {
      state,
      filtered,
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
      reload() {
        const channelId = state.channelId;
        if (channelId !== null) void load(channelId);
      },
    };
  },
});

export const MonitorProvider = context.provider;
export const useMonitor = context.use;
