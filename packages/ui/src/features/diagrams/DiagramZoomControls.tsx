/**
 * The zoom buttons in the corner of a node canvas: zoom in, zoom out, and fit, which also says the
 * zoom. The routine diagram and the Monitor canvas share them.
 */

import { Button, Minus, Plus, Scan } from "@openbot/ui";
import { useText } from "../../text";
import { DIAGRAM_ZOOM_STEP, type DiagramCamera } from "./diagram-camera";

export interface DiagramZoomControlsProps {
  camera: DiagramCamera;
  class?: string | undefined;
}

export function DiagramZoomControls(props: DiagramZoomControlsProps) {
  const { t, format } = useText();
  const fitLabel = () =>
    t("diagram.zoom.fit", { zoom: format.percent(props.camera.camera.scale, { maximumFractionDigits: 0 }) });
  return (
    <div
      class={["diagram-board-zoom", props.class]}
      role="toolbar"
      aria-label={t("diagram.zoom.label")}
      data-diagram-overlay=""
    >
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={t("diagram.zoom.in")}
        title={t("diagram.zoom.in")}
        onClick={() => props.camera.zoomBy(DIAGRAM_ZOOM_STEP)}
      >
        <Plus aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={t("diagram.zoom.out")}
        title={t("diagram.zoom.out")}
        onClick={() => props.camera.zoomBy(1 / DIAGRAM_ZOOM_STEP)}
      >
        <Minus aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={fitLabel()}
        title={fitLabel()}
        onClick={() => props.camera.fitView(true)}
      >
        <Scan aria-hidden="true" />
      </Button>
    </div>
  );
}
