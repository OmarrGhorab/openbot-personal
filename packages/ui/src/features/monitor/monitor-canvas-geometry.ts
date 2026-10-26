/**
 * The DOM-free geometry of the Monitor canvas: where a line between two agent cards starts and ends,
 * its curve, its arrow, and where its label sits. A line between two columns runs from side to side
 * with the S-curve of the routine diagram; a line inside one column runs from the bottom of one card
 * to the top of the other.
 */

import { diagramEdgeMidpoint, diagramEdgePath } from "../diagrams/diagram-graph";
import type { DiagramPoint } from "../diagrams/diagram-model";

/** The width of an agent card on the canvas. Its height comes from its content. */
export const MONITOR_CANVAS_CARD_WIDTH = 216;
/** The height a card has before it is measured. */
export const MONITOR_CANVAS_CARD_HEIGHT = 168;
/** The space between two columns, and between two cards of one column. */
export const MONITOR_CANVAS_COLUMN_GAP = 72;
export const MONITOR_CANVAS_ROW_GAP = 56;

export interface MonitorCanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MonitorCanvasSide = "start" | "end" | "top" | "bottom";

export interface MonitorCanvasLine {
  path: string;
  arrow: string;
  label: DiagramPoint;
}

const ARROW_LENGTH = 7;
const ARROW_HALF_WIDTH = 4.5;
/** A line ends this far from the card, so the arrow does not touch the border. */
const GAP = 4;

/** The two sides the line uses: side to side across columns, bottom to top inside one column. */
function sides(from: MonitorCanvasBox, to: MonitorCanvasBox): [MonitorCanvasSide, MonitorCanvasSide] {
  const fromCenter = from.x + from.width / 2;
  const toCenter = to.x + to.width / 2;
  if (Math.abs(toCenter - fromCenter) < (from.width + to.width) / 4) {
    return to.y >= from.y ? ["bottom", "top"] : ["top", "bottom"];
  }
  return toCenter > fromCenter ? ["end", "start"] : ["start", "end"];
}

function anchor(box: MonitorCanvasBox, side: MonitorCanvasSide): DiagramPoint {
  switch (side) {
    case "start":
      return { x: box.x - GAP, y: box.y + box.height / 2 };
    case "end":
      return { x: box.x + box.width + GAP, y: box.y + box.height / 2 };
    case "top":
      return { x: box.x + box.width / 2, y: box.y - GAP };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height + GAP };
  }
}

/** The direction a line travels as it enters a card through each side. */
const INWARD = {
  start: { dx: 1, dy: 0 },
  end: { dx: -1, dy: 0 },
  top: { dx: 0, dy: 1 },
  bottom: { dx: 0, dy: -1 },
} as const satisfies Record<MonitorCanvasSide, { dx: number; dy: number }>;

/** An arrowhead whose tip is at `tip`, pointing along `side`'s inward direction. */
function arrowAt(tip: DiagramPoint, side: MonitorCanvasSide): string {
  const { dx, dy } = INWARD[side];
  const baseX = tip.x - dx * ARROW_LENGTH;
  const baseY = tip.y - dy * ARROW_LENGTH;
  const left = { x: baseX - dy * ARROW_HALF_WIDTH, y: baseY + dx * ARROW_HALF_WIDTH };
  const right = { x: baseX + dy * ARROW_HALF_WIDTH, y: baseY - dx * ARROW_HALF_WIDTH };
  return `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y}`;
}

/** The line from one card to another, with its arrow at the second card and its label halfway. */
export function monitorCanvasLine(from: MonitorCanvasBox, to: MonitorCanvasBox): MonitorCanvasLine {
  const [out, into] = sides(from, to);
  const start = anchor(from, out);
  const end = anchor(to, into);
  let path: string;
  if (out === "end") {
    path = diagramEdgePath(start, end);
  } else if (out === "start") {
    // The same S-curve, mirrored: it leaves to the left and enters from the right.
    const bend = Math.max(48, Math.abs(end.x - start.x) / 2);
    path = `M ${start.x} ${start.y} C ${start.x - bend} ${start.y}, ${end.x + bend} ${end.y}, ${end.x} ${end.y}`;
  } else {
    const bend = Math.max(32, Math.abs(end.y - start.y) / 2) * (out === "bottom" ? 1 : -1);
    path = `M ${start.x} ${start.y} C ${start.x} ${start.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`;
  }
  return { path, arrow: arrowAt(end, into), label: diagramEdgeMidpoint(start, end) };
}

/** The box around every card, for the fit. */
export function monitorCanvasBounds(boxes: readonly MonitorCanvasBox[]): MonitorCanvasBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export type MonitorCanvasDirection = "left" | "right" | "up" | "down";

/**
 * The card the arrow key moves to from `current`: the nearest card whose centre lies in that
 * direction, with cards straight ahead preferred over cards off to the side.
 */
export function monitorCanvasNeighbor(
  boxes: ReadonlyMap<string, MonitorCanvasBox>,
  current: string,
  direction: MonitorCanvasDirection,
): string | null {
  const from = boxes.get(current);
  if (!from) return null;
  const center = (box: MonitorCanvasBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const origin = center(from);
  let best: { id: string; score: number } | null = null;
  for (const [id, box] of boxes) {
    if (id === current) continue;
    const point = center(box);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const ahead = { left: -dx, right: dx, up: -dy, down: dy }[direction];
    const aside = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    if (ahead <= 1) continue;
    const score = ahead + aside * 2;
    if (!best || score < best.score) best = { id, score };
  }
  return best?.id ?? null;
}
