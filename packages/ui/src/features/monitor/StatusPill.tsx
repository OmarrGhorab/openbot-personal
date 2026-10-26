/**
 * The status of an agent or a task: a coloured dot and a short word. `StatusPill` sits in a
 * header; `StatusLine` closes a card with an icon in the status colour.
 */

import { CircleCheck, CirclePause, CircleX, Clock3, LoaderCircle } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Match, Switch } from "solid-js";
import { useText } from "../../text";
import { MONITOR_STATUS_LABEL, type MonitorStatus } from "./monitor-status";

export function StatusDot(props: { status: MonitorStatus; class?: string }): JSX.Element {
  return <span class={["monitor-status-dot", props.class]} data-status={props.status} aria-hidden="true" />;
}

export interface StatusPillProps {
  status: MonitorStatus;
  /** Text in place of the status word, such as "Live". */
  label?: string | undefined;
  class?: string | undefined;
}

export function StatusPill(props: StatusPillProps): JSX.Element {
  const { t } = useText();
  return (
    <span class={["monitor-status-pill", props.class]} data-status={props.status}>
      <StatusDot status={props.status} />
      <span class="monitor-status-pill-label">{props.label ?? t(MONITOR_STATUS_LABEL[props.status])}</span>
    </span>
  );
}

export function StatusIcon(props: { status: MonitorStatus }): JSX.Element {
  return (
    <span class="monitor-status-icon" data-status={props.status} aria-hidden="true">
      <Switch>
        <Match when={props.status === "working"}>
          <LoaderCircle />
        </Match>
        <Match when={props.status === "waiting"}>
          <Clock3 />
        </Match>
        <Match when={props.status === "error"}>
          <CircleX />
        </Match>
        <Match when={props.status === "done"}>
          <CircleCheck />
        </Match>
        <Match when={props.status === "idle"}>
          <CirclePause />
        </Match>
      </Switch>
    </span>
  );
}

export interface StatusLineProps {
  status: MonitorStatus;
  /** Text in place of the status word, such as "Waiting on Chief". */
  label?: string | undefined;
  /** Text at the end of the line, such as "14m". */
  meta?: string | undefined;
}

export function StatusLine(props: StatusLineProps): JSX.Element {
  const { t } = useText();
  return (
    <div class="monitor-status-line" data-status={props.status}>
      <StatusIcon status={props.status} />
      <span class="monitor-status-line-label">{props.label ?? t(MONITOR_STATUS_LABEL[props.status])}</span>
      <span class="monitor-status-line-meta">{props.meta}</span>
    </div>
  );
}
