/**
 * What floats over the bottom corners of the Monitor canvas: the "Ask an agent about this channel"
 * button at the start, and the status legend (Working, Waiting, Error, Done) at the end.
 */

import { Button, Sparkles } from "@openbot/ui";
import { For } from "solid-js";
import { useText } from "../../text";
import { MONITOR_STATUS_LABEL, type MonitorStatus } from "./monitor-status";
import { StatusDot } from "./StatusPill";

const LEGEND: readonly MonitorStatus[] = ["working", "waiting", "error", "done"];

export interface MonitorCanvasFooterProps {
  /** Opens the ask panel. Without it, the button is off. */
  onAsk?: (() => void) | undefined;
}

export function MonitorCanvasFooter(props: MonitorCanvasFooterProps) {
  const { t } = useText();
  return (
    <>
      <Button
        type="button"
        variant="outline"
        class="monitor-canvas-ask"
        data-diagram-overlay=""
        disabled={!props.onAsk}
        onClick={() => props.onAsk?.()}
      >
        <span class="monitor-canvas-ask-icon" aria-hidden="true">
          <Sparkles />
        </span>
        {t("monitor.canvas.ask")}
      </Button>
      <ul class="monitor-canvas-legend" aria-label={t("monitor.canvas.legend")} data-diagram-overlay="">
        <For each={LEGEND}>
          {(status) => (
            <li class="monitor-canvas-legend-item">
              <StatusDot status={status} />
              {t(MONITOR_STATUS_LABEL[status])}
            </li>
          )}
        </For>
      </ul>
    </>
  );
}
