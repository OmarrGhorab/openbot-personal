import type { MonitorAgentStatus } from "@openbot/contracts/ipc";
import { IconButton, X } from "@openbot/ui";
import {
  MonitorCanvasBoard,
  type MonitorCanvasEdge,
  type MonitorCanvasNode,
} from "@openbot/ui/features/monitor/MonitorCanvasBoard";
import { MonitorCanvasFooter } from "@openbot/ui/features/monitor/MonitorCanvasFooter";
import { MonitorEmptyChannel } from "@openbot/ui/features/monitor/MonitorEmptyChannel";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, Show } from "solid-js";
import {
  buildMonitorCanvasGraph,
  layoutMonitorCanvas,
  type MonitorCanvasPoint,
  placeMonitorAgents,
} from "./monitor-canvas-graph";
import { useMonitor } from "./monitor-context";
import { MONITOR_FILTER_CHIP_LABEL, monitorChannelIdle } from "./monitor-filters";
import { summarizeMonitorSnapshot } from "./monitor-overview";

const BUSY: readonly MonitorAgentStatus[] = ["working", "waiting"];

/**
 * The canvas of the open channel: one card per agent in columns by hand-off order, and a line for
 * each pair of agents that work together. It follows each new snapshot without a new layout: a card
 * keeps its place, and only a new agent gets one. The filters hide cards; they move none.
 */
export function MonitorCanvas() {
  const { t } = useText();
  const monitor = useMonitor();
  const [layout, setLayout] = createStore<{ channelId: string | null; positions: Record<string, MonitorCanvasPoint> }>({
    channelId: null,
    positions: {},
  });

  /** The lines and columns of the whole channel, so a filter does not change them. */
  const graph = createMemo(() => {
    const snapshot = monitor.state.snapshot;
    return snapshot ? buildMonitorCanvasGraph(snapshot) : null;
  });

  createEffect(
    () => {
      const snapshot = monitor.state.snapshot;
      const current = graph();
      if (!snapshot || !current) return null;
      return {
        channelId: snapshot.channelId,
        ids: snapshot.agents.map((agent) => agent.id),
        columns: current.columns,
      };
    },
    (next) => {
      if (!next) return;
      setLayout((draft) => {
        const previous = draft.channelId === next.channelId ? { ...draft.positions } : {};
        draft.channelId = next.channelId;
        draft.positions = placeMonitorAgents(previous, layoutMonitorCanvas(next.ids, next.columns));
      });
    },
  );

  const agents = createMemo(() => {
    const snapshot = monitor.state.snapshot;
    return snapshot ? summarizeMonitorSnapshot(snapshot).agents : [];
  });
  const statusOf = createMemo(() => new Map(agents().map((agent) => [agent.id, agent.status])));
  const nameOf = (id: string) => monitor.state.snapshot?.agents.find((agent) => agent.id === id)?.name ?? "";

  /** The status filter of the sidebar. The canvas dims the agents that do not match it; it hides none. */
  const filterStatus = () => monitor.statusFilter();
  const nodes = createMemo((): MonitorCanvasNode[] => {
    const snapshot = monitor.state.snapshot;
    const givenBy = graph()?.givenBy;
    return agents().flatMap((agent) => {
      const position = layout.positions[agent.id];
      const source = snapshot?.agents.find((entry) => entry.id === agent.id);
      if (!position || !source) return [];
      const giver = givenBy?.get(agent.id);
      return [
        {
          id: agent.id,
          position,
          dimmed: filterStatus() !== null && agent.status !== filterStatus(),
          card: {
            agent: { avatarSeed: agent.avatarSeed, avatarHue: agent.avatarHue, avatarUrl: agent.avatarUrl },
            name: agent.name,
            kicker: source.lead ? t("monitor.canvas.lead") : undefined,
            task: agent.detail,
            progress:
              agent.status === "working" && source.step
                ? { value: source.step.index / source.step.total, step: source.step }
                : undefined,
            status: agent.status,
            statusLabel:
              agent.status === "waiting" && giver ? t("monitor.canvas.waitingOn", { name: nameOf(giver) }) : undefined,
            since: agent.since,
          },
        },
      ];
    });
  });

  const dimmedAgents = createMemo(
    () =>
      new Set(
        nodes()
          .filter((node) => node.dimmed)
          .map((node) => node.id),
      ),
  );
  const edges = createMemo((): MonitorCanvasEdge[] => {
    const status = statusOf();
    const dimmedIds = dimmedAgents();
    return (graph()?.links ?? []).flatMap((link) => {
      const to = status.get(link.to);
      const from = status.get(link.from);
      if (!to || !from) return [];
      const active = BUSY.includes(to) || (!link.handoff && BUSY.includes(from));
      return [
        {
          id: link.id,
          from: link.from,
          to: link.to,
          label:
            link.messages > 0 ? t("monitor.canvas.messages", { count: link.messages }) : t("monitor.canvas.assigned"),
          state: active ? "active" : "done",
          dimmed: dimmedIds.has(link.from) && dimmedIds.has(link.to),
        },
      ];
    });
  });

  const idle = createMemo(() => {
    const snapshot = monitor.state.snapshot;
    return snapshot !== null && monitorChannelIdle(snapshot);
  });
  /** The chip that names the status the canvas shows, with the way to clear it. */
  const chip = () => {
    const status = filterStatus();
    if (!status) return undefined;
    const count = nodes().filter((node) => !node.dimmed).length;
    return (
      <div class="monitor-filter-chip" role="status">
        <span>{t(MONITOR_FILTER_CHIP_LABEL[status], { count })}</span>
        <IconButton
          variant="ghost"
          class="monitor-filter-chip-clear"
          label={t("monitor.filter.clear")}
          onClick={() => monitor.clearFilters()}
        >
          <X aria-hidden="true" />
        </IconButton>
      </div>
    );
  };

  return (
    <Show
      when={nodes().length > 0 || !monitor.state.snapshot}
      fallback={<p class="monitor-page-note monitor-canvas-note">{t("monitor.canvas.empty")}</p>}
    >
      <Show
        when={!idle()}
        fallback={
          <MonitorEmptyChannel
            title={t("monitor.empty.title", { name: monitor.state.snapshot?.channelName ?? "" })}
            onCreateRoutine={() => monitor.openRoutines()}
          />
        }
      >
        <MonitorCanvasBoard
          label={monitor.state.snapshot?.channelName ?? ""}
          nodes={nodes()}
          edges={edges()}
          selectedId={monitor.state.selectedAgentId}
          onSelectNode={monitor.selectAgent}
          onClearSelection={monitor.clearAgent}
          onOpenEdge={(edge) => monitor.openConversation([edge.from, edge.to])}
          overlay={chip()}
        >
          <MonitorCanvasFooter />
        </MonitorCanvasBoard>
      </Show>
    </Show>
  );
}
