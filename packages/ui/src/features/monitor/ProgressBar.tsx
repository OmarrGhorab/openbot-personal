/**
 * How far an agent is in its task: "Step 3 of 5 · Wiring data", the percentage, and a bar in the
 * status colour. It wraps the shared `Progress` primitive.
 */

import type { MonitorStep } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { Progress } from "../../progress";
import { useText } from "../../text";
import type { MonitorStatus } from "./monitor-status";

export interface ProgressBarProps {
  /** From 0 to 1. */
  value: number;
  step?: MonitorStep | null | undefined;
  /** What the current step does, such as "Wiring data". */
  label?: string | undefined;
  /** Text after the percentage, such as "started 14 min ago". */
  detail?: string | undefined;
  status?: MonitorStatus | undefined;
  class?: string | undefined;
}

export function ProgressBar(props: ProgressBarProps): JSX.Element {
  const { t, format } = useText();
  const ratio = () => Math.min(1, Math.max(0, props.value));
  const caption = () => {
    const step = props.step;
    if (step && props.label)
      return t("monitor.progress.stepLabel", { index: step.index, total: step.total, label: props.label });
    if (step) return t("monitor.progress.step", { index: step.index, total: step.total });
    return props.label ?? "";
  };
  const percent = () => format.percent(ratio());
  return (
    <div class={["monitor-progress", props.class]} data-status={props.status ?? "working"}>
      <div class="monitor-progress-text">
        <span class="monitor-progress-caption">{caption()}</span>
        <span class="monitor-progress-value">
          <Show when={props.detail} fallback={percent()}>
            {(detail) => t("monitor.progress.valueDetail", { value: percent(), detail: detail() })}
          </Show>
        </span>
      </div>
      <Progress
        class="monitor-progress-bar"
        value={ratio() * 100}
        aria-label={caption() || t("monitor.progress.label")}
      />
    </div>
  );
}
