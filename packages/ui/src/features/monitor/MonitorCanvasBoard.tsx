/**
 * The node canvas of one Monitor channel: one card per agent, and a curved line for each pair of
 * agents that work together. An active line is blue and dashed; a finished one is grey. Each line has
 * a label button, which opens the conversation between the two agents. A card button selects its
 * agent.
 *
 * It reuses the camera of the routine diagram: drag the background or scroll to move, pinch or hold
 * Command or Ctrl and scroll to zoom. With a card focused, the arrow keys move the focus to the
 * nearest card in that direction and Enter selects it; with the canvas focused, they move the view.
 *
 * The caller places the cards, so a new snapshot moves nothing the user already sees. The canvas
 * mirrors the places in a right-to-left language, so hand-offs read in the reading direction.
 */

import { localeDirection } from "@openbot/i18n";
import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createStore, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { DiagramZoomControls } from "../diagrams/DiagramZoomControls";
import { createDiagramCamera, DIAGRAM_ZOOM_STEP } from "../diagrams/diagram-camera";
import type { DiagramPoint } from "../diagrams/diagram-model";
import { AgentNodeCard, type AgentNodeCardProps } from "./AgentNodeCard";
import {
  MONITOR_CANVAS_CARD_HEIGHT,
  MONITOR_CANVAS_CARD_WIDTH,
  type MonitorCanvasBox,
  type MonitorCanvasDirection,
  monitorCanvasBounds,
  monitorCanvasLine,
  monitorCanvasNeighbor,
} from "./monitor-canvas-geometry";

const KEY_STEP = 48;
const ARROW_DIRECTION: Readonly<Record<string, MonitorCanvasDirection>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
/** How far an arrow key moves the view when the canvas itself has the focus. */
const PAN_STEP = {
  left: { x: KEY_STEP, y: 0 },
  right: { x: -KEY_STEP, y: 0 },
  up: { x: 0, y: KEY_STEP },
  down: { x: 0, y: -KEY_STEP },
} as const satisfies Record<MonitorCanvasDirection, { x: number; y: number }>;
const GRID = 24;
/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD = 4;
/** The margin the view keeps around a card that the keyboard focuses. */
const FOCUS_MARGIN = 32;

export interface MonitorCanvasNode {
  /** The agent id. */
  id: string;
  /** The top-left corner of the card, in left-to-right canvas units. */
  position: DiagramPoint;
  card: Omit<AgentNodeCardProps, "selected" | "onSelect" | "class">;
}

export type MonitorCanvasEdgeState = "active" | "done";

export interface MonitorCanvasEdge {
  id: string;
  /** The agent that gave the work or wrote first. The arrow points at `to`. */
  from: string;
  to: string;
  /** "14 messages", or the hand-off. */
  label: string;
  state: MonitorCanvasEdgeState;
}

export interface MonitorCanvasBoardProps {
  /** The accessible name of the canvas, such as the channel name. */
  label: string;
  nodes: readonly MonitorCanvasNode[];
  edges: readonly MonitorCanvasEdge[];
  selectedId: string | null;
  onSelectNode: (id: string) => void;
  /** A click on the empty canvas. */
  onClearSelection?: (() => void) | undefined;
  onOpenEdge: (edge: MonitorCanvasEdge) => void;
  /** The clock for the card times. */
  now?: Date | undefined;
  /** What floats over the bottom corners, such as the legend. */
  children?: JSX.Element;
}

export function MonitorCanvasBoard(props: MonitorCanvasBoardProps) {
  const { t, locale } = useText();
  const rtl = () => localeDirection(locale()) === "rtl";
  let viewport: HTMLDivElement | undefined;
  /** The measured height of each card, by agent id. A card grows with its task text. */
  const [heights, setHeights] = createStore<Record<string, number>>({});

  /** Each card's box in canvas units, mirrored in a right-to-left language. */
  const boxes = createMemo(() => {
    const flip = rtl();
    return new Map<string, MonitorCanvasBox>(
      props.nodes.map((node) => [
        node.id,
        {
          x: flip ? -node.position.x - MONITOR_CANVAS_CARD_WIDTH : node.position.x,
          y: node.position.y,
          width: MONITOR_CANVAS_CARD_WIDTH,
          height: heights[node.id] ?? MONITOR_CANVAS_CARD_HEIGHT,
        },
      ]),
    );
  });
  const nameOf = (id: string) => props.nodes.find((node) => node.id === id)?.card.name ?? "";

  const cameraControl = createDiagramCamera({
    viewport: () => viewport,
    bounds: () => monitorCanvasBounds([...boxes().values()]),
  });
  const { camera, local, moveCamera, zoomBy, fitView } = cameraControl;

  const cardButton = (id: string) =>
    viewport?.querySelector<HTMLButtonElement>(`[data-monitor-node="${CSS.escape(id)}"] button`) ?? null;

  /** Moves the view just enough that the card is on screen with a margin. */
  const reveal = (id: string) => {
    const box = boxes().get(id);
    const area = viewport;
    if (!box || !area) return;
    const left = box.x * camera.scale + camera.x;
    const top = box.y * camera.scale + camera.y;
    const right = left + box.width * camera.scale;
    const bottom = top + box.height * camera.scale;
    let dx = 0;
    let dy = 0;
    if (left < FOCUS_MARGIN) dx = FOCUS_MARGIN - left;
    else if (right > area.clientWidth - FOCUS_MARGIN) dx = area.clientWidth - FOCUS_MARGIN - right;
    if (top < FOCUS_MARGIN) dy = FOCUS_MARGIN - top;
    else if (bottom > area.clientHeight - FOCUS_MARGIN) dy = area.clientHeight - FOCUS_MARGIN - bottom;
    if (dx || dy) moveCamera({ x: camera.x + dx, y: camera.y + dy, scale: camera.scale }, true);
  };

  onSettled(() => {
    const area = viewport;
    if (!area) return;
    const detachCamera = cameraControl.attach();
    let pan: { start: DiagramPoint; origin: { x: number; y: number }; moved: boolean } | undefined;
    const onMove = (event: PointerEvent) => {
      if (!pan) return;
      const point = local(event);
      const dx = point.x - pan.start.x;
      const dy = point.y - pan.start.y;
      if (!pan.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      pan.moved = true;
      area.dataset.panning = "";
      moveCamera({ x: pan.origin.x + dx, y: pan.origin.y + dy, scale: camera.scale }, false);
    };
    const onUp = () => {
      const ended = pan;
      pan = undefined;
      delete area.dataset.panning;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (ended && !ended.moved) props.onClearSelection?.();
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      // A card, a line label and the overlays take their own clicks.
      if (event.target.closest("button, [data-monitor-node], [data-diagram-overlay]")) return;
      pan = { start: local(event), origin: { x: camera.x, y: camera.y }, moved: false };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
    area.addEventListener("pointerdown", onDown);
    return () => {
      detachCamera();
      area.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  });

  const setHeight = (id: string, height: number | null) =>
    setHeights((draft) => {
      if (height === null) delete draft[id];
      else draft[id] = height;
    });

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.target instanceof HTMLElement) || event.target.closest("[data-diagram-overlay]")) return;
    const direction = ARROW_DIRECTION[event.key];
    const focused = event.target.closest<HTMLElement>("[data-monitor-node]")?.dataset.monitorNode;
    if (direction && focused) {
      const next = monitorCanvasNeighbor(boxes(), focused, direction);
      if (next) {
        cardButton(next)?.focus({ preventScroll: true });
        reveal(next);
      }
    } else if (direction && event.target === viewport) {
      const { x, y } = PAN_STEP[direction];
      moveCamera({ x: camera.x + x, y: camera.y + y, scale: camera.scale }, true);
    } else if (event.key === "+" || event.key === "=") zoomBy(DIAGRAM_ZOOM_STEP);
    else if (event.key === "-") zoomBy(1 / DIAGRAM_ZOOM_STEP);
    else if (event.key === "0") fitView(true);
    else return;
    event.preventDefault();
  };

  return (
    <div class="diagram-board monitor-canvas">
      <div
        ref={(element) => (viewport = element)}
        class="diagram-board-viewport monitor-canvas-viewport"
        style={cameraControl.gridStyle(GRID)}
        role="application"
        aria-label={props.label}
        aria-roledescription={t("monitor.canvas.role")}
        tabindex="0"
        onKeyDown={onKeyDown}
      >
        <div
          class="diagram-board-world"
          data-settling={camera.settling ? "" : undefined}
          style={{ transform: cameraControl.worldTransform() }}
        >
          <svg class="diagram-edges monitor-canvas-edges" aria-hidden="true">
            <For each={props.edges} keyed={(edge) => edge.id}>
              {(edge) => {
                const line = () => {
                  const from = boxes().get(edge().from);
                  const to = boxes().get(edge().to);
                  return from && to ? monitorCanvasLine(from, to) : undefined;
                };
                return (
                  <Show when={line()}>
                    {(current) => (
                      <g class="monitor-canvas-edge" data-state={edge().state}>
                        <path class="monitor-canvas-edge-line" d={current().path} />
                        <path class="monitor-canvas-edge-arrow" d={current().arrow} />
                      </g>
                    )}
                  </Show>
                );
              }}
            </For>
          </svg>

          <For each={props.edges} keyed={(edge) => edge.id}>
            {(edge) => {
              const point = () => {
                const from = boxes().get(edge().from);
                const to = boxes().get(edge().to);
                return from && to ? monitorCanvasLine(from, to).label : undefined;
              };
              return (
                <Show when={point()}>
                  {(at) => (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      class="monitor-canvas-edge-label"
                      data-state={edge().state}
                      style={{ "--monitor-edge-x": `${at().x}px`, "--monitor-edge-y": `${at().y}px` }}
                      aria-label={t("monitor.canvas.openConversation", {
                        label: edge().label,
                        from: nameOf(edge().from),
                        to: nameOf(edge().to),
                      })}
                      onClick={() => props.onOpenEdge(edge())}
                    >
                      {edge().label}
                    </Button>
                  )}
                </Show>
              );
            }}
          </For>

          <For each={props.nodes} keyed={(node) => node.id}>
            {(node) => {
              const box = () => boxes().get(node().id);
              return (
                <MonitorCanvasNodeSlot id={node().id} box={box()} onHeight={(height) => setHeight(node().id, height)}>
                  <AgentNodeCard
                    {...node().card}
                    now={props.now ?? node().card.now}
                    selected={props.selectedId === node().id}
                    onSelect={() => props.onSelectNode(node().id)}
                  />
                </MonitorCanvasNodeSlot>
              );
            }}
          </For>
        </div>
      </div>

      <DiagramZoomControls camera={cameraControl} class="monitor-canvas-zoom" />
      {props.children}
    </div>
  );
}

/** Places one card on the canvas and reports its height while it is there. */
function MonitorCanvasNodeSlot(props: {
  id: string;
  box: MonitorCanvasBox | undefined;
  onHeight: (height: number | null) => void;
  children: JSX.Element;
}) {
  let element: HTMLDivElement | undefined;
  onSettled(() => {
    const slot = element;
    if (!slot) return;
    const observer = new ResizeObserver(() => {
      if (slot.offsetHeight) props.onHeight(slot.offsetHeight);
    });
    observer.observe(slot);
    return () => {
      observer.disconnect();
      props.onHeight(null);
    };
  });
  return (
    <div
      ref={(slot) => (element = slot)}
      class="monitor-canvas-node"
      data-monitor-node={props.id}
      style={{
        "--monitor-node-x": `${props.box?.x ?? 0}px`,
        "--monitor-node-y": `${props.box?.y ?? 0}px`,
        "--monitor-node-width": `${MONITOR_CANVAS_CARD_WIDTH}px`,
      }}
    >
      {props.children}
    </div>
  );
}
