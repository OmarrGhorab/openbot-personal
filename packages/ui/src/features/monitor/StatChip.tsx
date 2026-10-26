/** One count in the Monitor summary, such as how many agents work now. */

import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";
import { MONITOR_STATUS_LABEL, type MonitorStatus } from "./monitor-status";
import { StatusDot } from "./StatusPill";

export interface StatChipProps {
  value: number;
  /** The status the count is for. It gives the dot and, without `label`, the word. */
  status?: MonitorStatus | undefined;
  label?: string | undefined;
  class?: string | undefined;
}

export function StatChip(props: StatChipProps): JSX.Element {
  const { t, format } = useText();
  const label = () => {
    if (props.label !== undefined) return props.label;
    return props.status ? t(MONITOR_STATUS_LABEL[props.status]) : "";
  };
  return (
    <div class={["monitor-stat", props.class]} data-status={props.status}>
      <span class="monitor-stat-label">
        <Show when={props.status}>{(status) => <StatusDot status={status()} />}</Show>
        {label()}
      </span>
      <span class="monitor-stat-value">{format.number(props.value)}</span>
    </div>
  );
}
