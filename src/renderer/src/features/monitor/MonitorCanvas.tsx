import type { MonitorAgentStatus } from "@openbot/contracts/ipc";
import {
  MonitorCanvasBoard,
  type MonitorCanvasEdge,
  type MonitorCanvasNode,
} from "@openbot/ui/features/monitor/MonitorCanvasBoard";
import { MonitorCanvasFooter } from "@openbot/ui/features/monitor/MonitorCanvasFooter";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, Show } from "solid-js";
import {
  buildMonitorCanvasGraph,
  layoutMonitorCanvas,
  type MonitorCanvasPoint,
  placeMonitorAgents,
} from "./monitor-canvas-graph";
import { useMonitor } from "./monitor-context";
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
    const snapshot = monitor.filtered();
    return snapshot ? summarizeMonitorSnapshot(snapshot).agents : [];
  });
  const statusOf = createMemo(() => new Map(agents().map((agent) => [agent.id, agent.status])));
  const nameOf = (id: string) => monitor.state.snapshot?.agents.find((agent) => agent.id === id)?.name ?? "";

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

  const edges = createMemo((): MonitorCanvasEdge[] => {
    const status = statusOf();
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
        },
      ];
    });
  });

  return (
    <Show
      when={nodes().length > 0 || !monitor.state.snapshot}
      fallback={<p class="monitor-page-note monitor-canvas-note">{t("monitor.canvas.empty")}</p>}
    >
      <MonitorCanvasBoard
        label={monitor.state.snapshot?.channelName ?? ""}
        nodes={nodes()}
        edges={edges()}
        selectedId={monitor.state.selectedAgentId}
        onSelectNode={monitor.selectAgent}
        onClearSelection={monitor.clearAgent}
        onOpenEdge={(edge) => monitor.openConversation([edge.from, edge.to])}
      >
        <MonitorCanvasFooter />
      </MonitorCanvasBoard>
    </Show>
  );
}
