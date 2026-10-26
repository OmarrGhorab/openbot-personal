import type { MonitorSnapshot } from "@openbot/contracts/ipc";
import {
  MONITOR_CANVAS_CARD_HEIGHT,
  MONITOR_CANVAS_CARD_WIDTH,
  MONITOR_CANVAS_COLUMN_GAP,
  MONITOR_CANVAS_ROW_GAP,
} from "@openbot/ui/features/monitor/monitor-canvas-geometry";

export interface MonitorCanvasPoint {
  x: number;
  y: number;
}

/** One line of the canvas: the hand-off and the messages between two agents. */
interface MonitorCanvasLink {
  /** The two agent ids in ascending order, joined. One line per pair. */
  id: string;
  /** The agent that gave the work, or else wrote first. */
  from: string;
  to: string;
  /** True when `from` gave `to` a task. */
  handoff: boolean;
  messages: number;
}

export interface MonitorCanvasGraph {
  /** The column of each agent: 0 for the agents nobody gave work to, one more for each hand-off. */
  columns: Map<string, number>;
  links: MonitorCanvasLink[];
  /** For each agent, the agent that gave it its work. */
  givenBy: Map<string, string>;
}

const pairId = (left: string, right: string) => (left < right ? `${left}|${right}` : `${right}|${left}`);

/**
 * The lines and columns of a channel. A hand-off is a task whose parent task belongs to another
 * agent. Agents go in columns by hand-off order: each agent sits one column after the agent that
 * gave it work. Messages without a hand-off point from the agent that wrote first, or else from the
 * earlier column.
 */
export function buildMonitorCanvasGraph(snapshot: MonitorSnapshot): MonitorCanvasGraph {
  const agentIds = new Set(snapshot.agents.map((agent) => agent.id));
  const taskOwner = new Map(snapshot.tasks.map((task) => [task.id, task.agentId]));
  const links = new Map<string, MonitorCanvasLink>();
  const givenBy = new Map<string, string>();

  for (const task of snapshot.tasks) {
    const to = task.agentId;
    const from = task.parentTaskId ? taskOwner.get(task.parentTaskId) : null;
    if (!to || !from || from === to || !agentIds.has(from) || !agentIds.has(to)) continue;
    const id = pairId(from, to);
    // The first hand-off of a pair sets its direction; a hand-off back does not draw a second line.
    if (!links.has(id)) links.set(id, { id, from, to, handoff: true, messages: 0 });
    if (!givenBy.has(to)) givenBy.set(to, from);
  }

  // Events are newest first, so the last match is the first message of the pair.
  const firstWriter = new Map<string, { from: string; to: string }>();
  for (const event of snapshot.events) {
    if (event.kind !== "agent-message") continue;
    firstWriter.set(pairId(event.fromAgentId, event.toAgentId), { from: event.fromAgentId, to: event.toAgentId });
  }
  const unoriented: MonitorCanvasLink[] = [];
  for (const pair of snapshot.pairs) {
    const [left, right] = pair.agentIds;
    if (!agentIds.has(left) || !agentIds.has(right) || left === right) continue;
    const id = pairId(left, right);
    const existing = links.get(id);
    if (existing) {
      existing.messages = pair.count;
      continue;
    }
    const writer = firstWriter.get(id);
    const link = { id, from: writer?.from ?? left, to: writer?.to ?? right, handoff: false, messages: pair.count };
    links.set(id, link);
    if (!writer) unoriented.push(link);
  }

  const ids = snapshot.agents.map((agent) => agent.id);
  const handoffs = [...links.values()].filter((link) => link.handoff);
  const columns = monitorColumns(ids, handoffs, snapshot.agents.find((agent) => agent.lead)?.id ?? null);
  // Only hand-offs set the columns. An agent with no hand-off sits one column after the agent it
  // talks to, so it is near its line; with no line, it stays in the first column.
  const inHandoff = new Set(handoffs.flatMap((link) => [link.from, link.to]));
  for (const id of ids) {
    if (inHandoff.has(id)) continue;
    const partner = [...links.values()].find(
      (link) => (link.from === id && inHandoff.has(link.to)) || (link.to === id && inHandoff.has(link.from)),
    );
    const other = partner ? (partner.from === id ? partner.to : partner.from) : null;
    columns.set(id, other ? (columns.get(other) ?? 0) + 1 : 0);
  }
  // A pair that only has a count points from the earlier column, so it never runs backwards.
  for (const link of unoriented) {
    if ((columns.get(link.from) ?? 0) > (columns.get(link.to) ?? 0)) [link.from, link.to] = [link.to, link.from];
  }
  return { columns, links: [...links.values()], givenBy };
}

/** The longest chain of links that reaches each agent. A link that closes a cycle is skipped. */
function monitorColumns(
  ids: readonly string[],
  links: readonly Pick<MonitorCanvasLink, "from" | "to">[],
  leadId: string | null,
): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  for (const link of links) outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link.to]);
  const incoming = new Set(links.map((link) => link.to));
  const columns = new Map<string, number>();
  const onPath = new Set<string>();
  const visit = (id: string, column: number) => {
    if (onPath.has(id) || (columns.get(id) ?? -1) >= column) return;
    columns.set(id, column);
    onPath.add(id);
    for (const next of outgoing.get(id) ?? []) visit(next, column + 1);
    onPath.delete(id);
  };
  // The lead starts first, so a channel whose links form a cycle still puts the lead at the start.
  const roots = [...ids].sort((left, right) => Number(right === leadId) - Number(left === leadId));
  for (const id of roots) if (!incoming.has(id)) visit(id, 0);
  for (const id of roots) if (!columns.has(id)) visit(id, 0);
  return columns;
}

/**
 * Where each card goes by the graph: one column per hand-off step, and the cards of a column stacked
 * around the middle in the order of the snapshot.
 */
export function layoutMonitorCanvas(
  agentIds: readonly string[],
  columns: ReadonlyMap<string, number>,
): Record<string, MonitorCanvasPoint> {
  const byColumn = new Map<number, string[]>();
  for (const id of agentIds) {
    const column = columns.get(id) ?? 0;
    byColumn.set(column, [...(byColumn.get(column) ?? []), id]);
  }
  const positions: Record<string, MonitorCanvasPoint> = {};
  const rowHeight = MONITOR_CANVAS_CARD_HEIGHT + MONITOR_CANVAS_ROW_GAP;
  for (const [column, ids] of byColumn) {
    ids.forEach((id, row) => {
      positions[id] = {
        x: column * (MONITOR_CANVAS_CARD_WIDTH + MONITOR_CANVAS_COLUMN_GAP),
        y: (row - (ids.length - 1) / 2) * rowHeight,
      };
    });
  }
  return positions;
}

/**
 * The places of the cards after a new snapshot. A card on the canvas keeps its place, so nothing
 * jumps; a new agent takes its place from the layout, moved down while a card is already there; an
 * agent that left the channel loses its place.
 */
export function placeMonitorAgents(
  previous: Readonly<Record<string, MonitorCanvasPoint>>,
  layout: Readonly<Record<string, MonitorCanvasPoint>>,
): Record<string, MonitorCanvasPoint> {
  const placed: Record<string, MonitorCanvasPoint> = {};
  for (const id of Object.keys(layout)) {
    const kept = previous[id];
    if (kept) placed[id] = kept;
  }
  const rowHeight = MONITOR_CANVAS_CARD_HEIGHT + MONITOR_CANVAS_ROW_GAP;
  const taken = (point: MonitorCanvasPoint) =>
    Object.values(placed).some(
      (other) => Math.abs(other.x - point.x) < MONITOR_CANVAS_CARD_WIDTH && Math.abs(other.y - point.y) < rowHeight,
    );
  for (const [id, point] of Object.entries(layout)) {
    if (placed[id]) continue;
    const next = { ...point };
    while (taken(next)) next.y += rowHeight;
    placed[id] = next;
  }
  return placed;
}
