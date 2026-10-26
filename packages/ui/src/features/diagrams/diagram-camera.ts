/**
 * The camera of a node canvas: where the world sits in the viewport and how far it is zoomed. The
 * routine diagram and the Monitor canvas share it, so both pan, zoom and fit the same way. The camera
 * owns no gesture: each canvas reads its own pointer and calls `moveCamera`.
 */

import { prefersReducedMotion } from "@openbot/ui/utils";
import { createStore } from "solid-js";
import type { DiagramPoint } from "./diagram-model";

export const DIAGRAM_MIN_SCALE = 0.25;
export const DIAGRAM_MAX_SCALE = 2;
export const DIAGRAM_ZOOM_STEP = 1.2;
const WHEEL_ZOOM_RATE = 0.01;
const FIT_MARGIN = 64;

export interface DiagramBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramCameraOptions {
  viewport: () => HTMLElement | undefined;
  /** The part of the world that `fitView` shows. */
  bounds: () => DiagramBox;
  /** The largest scale `fitView` picks. Defaults to 1. */
  maxFitScale?: number;
}

export function createDiagramCamera(options: DiagramCameraOptions) {
  const [camera, setCamera] = createStore({ x: 0, y: 0, scale: 1, settling: false });
  /** True once the user moved the camera. Until then, a resize fits the world again. */
  let moved = false;

  const view = () => ({ width: options.viewport()?.clientWidth ?? 0, height: options.viewport()?.clientHeight ?? 0 });
  const local = (event: { clientX: number; clientY: number }): DiagramPoint => {
    const rect = options.viewport()?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const toWorld = (point: DiagramPoint): DiagramPoint => ({
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  });
  const clampScale = (scale: number) => Math.min(Math.max(scale, DIAGRAM_MIN_SCALE), DIAGRAM_MAX_SCALE);
  const moveCamera = (next: { x: number; y: number; scale: number }, animate: boolean, byUser = true) => {
    moved ||= byUser;
    setCamera((state) => {
      state.x = next.x;
      state.y = next.y;
      state.scale = clampScale(next.scale);
      // Buttons and keys glide to the new view; a drag, a scroll or a pinch follows at once.
      state.settling = animate && !prefersReducedMotion();
    });
  };
  const zoomAround = (scale: number, point: DiagramPoint) => {
    const next = clampScale(scale);
    return {
      scale: next,
      x: point.x - ((point.x - camera.x) * next) / camera.scale,
      y: point.y - ((point.y - camera.y) * next) / camera.scale,
    };
  };
  const zoomBy = (factor: number) =>
    moveCamera(zoomAround(camera.scale * factor, { x: view().width / 2, y: view().height / 2 }), true);
  const fitView = (animate: boolean) => {
    const bounds = options.bounds();
    const { width, height } = view();
    if (!width || !height) return;
    if (!bounds.width) {
      moveCamera({ x: width / 2, y: height / 2, scale: 1 }, animate, false);
      return;
    }
    const scale = clampScale(
      Math.min(
        (width - FIT_MARGIN * 2) / bounds.width,
        (height - FIT_MARGIN * 2) / bounds.height,
        options.maxFitScale ?? 1,
      ),
    );
    moveCamera(
      {
        scale,
        x: (width - bounds.width * scale) / 2 - bounds.x * scale,
        y: (height - bounds.height * scale) / 2 - bounds.y * scale,
      },
      animate,
      false,
    );
  };
  /** Scrolls the world, or zooms around the pointer when Ctrl or Command is held or a trackpad pinches. */
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    // A trackpad pinch arrives as a wheel event with Ctrl held.
    if (event.ctrlKey || event.metaKey) {
      moveCamera(zoomAround(camera.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), local(event)), false);
      return;
    }
    const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
    const down = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
    moveCamera({ x: camera.x - sideways, y: camera.y - down, scale: camera.scale }, false);
  };
  /**
   * Listens for the wheel on the viewport and keeps the world fitted while the viewport resizes,
   * until the user moves the camera. Returns the cleanup.
   */
  const attach = () => {
    const area = options.viewport();
    if (!area) return () => undefined;
    const onResize = new ResizeObserver(() => {
      if (!moved && area.clientWidth) fitView(false);
    });
    area.addEventListener("wheel", onWheel, { passive: false });
    onResize.observe(area);
    return () => {
      area.removeEventListener("wheel", onWheel);
      onResize.disconnect();
    };
  };
  /** The style of the dotted grid behind the world, which moves with the camera. */
  const gridStyle = (grid: number) => ({
    "--diagram-grid-size": `${grid * camera.scale}px`,
    "--diagram-grid-x": `${camera.x}px`,
    "--diagram-grid-y": `${camera.y}px`,
  });
  const worldTransform = () => `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;

  return {
    camera,
    local,
    toWorld,
    moveCamera,
    zoomAround,
    zoomBy,
    fitView,
    attach,
    gridStyle,
    worldTransform,
    /** Whether the user moved the camera since the last fit they did not ask for. */
    userMoved: () => moved,
  };
}

export type DiagramCamera = ReturnType<typeof createDiagramCamera>;
