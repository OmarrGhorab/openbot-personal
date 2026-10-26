/**
 * One tool call: an icon for its kind, a title, the short argument, and its status with the
 * duration. The argument must already be redacted: the Monitor data redacts it before it leaves
 * the main process. The whole row selects the call when `onSelect` is set.
 */

import type { MonitorToolCallStatus } from "@openbot/contracts/ipc";
import { Button, File, FilePen, Globe2, Search, Terminal, Wrench } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import {
  MONITOR_TOOL_KIND_LABEL,
  MONITOR_TOOL_STATUS_LABEL,
  MONITOR_TOOL_STATUS_TONE,
  type MonitorToolKind,
  monitorToolKind,
} from "./monitor-status";
import { monitorDuration } from "./monitor-time";
import { StatusIcon } from "./StatusPill";

export interface ToolCallRowProps {
  /** The tool name as the provider reports it, such as `Edit` or `exec_command`. */
  tool: string;
  /** The short argument, redacted. */
  argument: string;
  status: MonitorToolCallStatus;
  durationMs?: number | null | undefined;
  /** Text in place of the status word, such as "Passed". */
  statusLabel?: string | undefined;
  selected?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  class?: string | undefined;
}

export function ToolCallRow(props: ToolCallRowProps): JSX.Element {
  const { t, format } = useText();
  const kind = (): MonitorToolKind => monitorToolKind(props.tool);
  const title = () => {
    const value = kind();
    return value === "other" ? props.tool : t(MONITOR_TOOL_KIND_LABEL[value]);
  };
  const outcome = () => {
    const duration =
      props.status !== "running" && props.durationMs != null ? monitorDuration(props.durationMs, t, format) : undefined;
    const label =
      props.statusLabel ??
      (props.status === "done" && duration ? undefined : t(MONITOR_TOOL_STATUS_LABEL[props.status]));
    if (label && duration) return t("monitor.tool.outcome", { status: label, duration });
    return label ?? duration ?? "";
  };
  return (
    <div
      class={["monitor-tool-row", props.class]}
      data-status={MONITOR_TOOL_STATUS_TONE[props.status]}
      data-selected={props.selected ? "" : undefined}
    >
      <Show when={props.onSelect}>
        {(onSelect) => (
          <Button
            type="button"
            variant="ghost"
            class="monitor-select"
            aria-label={t("monitor.tool.select", { tool: title(), argument: props.argument })}
            aria-pressed={props.selected ? "true" : "false"}
            onClick={() => onSelect()()}
          />
        )}
      </Show>
      <span class="monitor-tool-icon" aria-hidden="true">
        <Switch fallback={<Wrench />}>
          <Match when={kind() === "edit"}>
            <FilePen />
          </Match>
          <Match when={kind() === "read"}>
            <File />
          </Match>
          <Match when={kind() === "command"}>
            <Terminal />
          </Match>
          <Match when={kind() === "search"}>
            <Search />
          </Match>
          <Match when={kind() === "web"}>
            <Globe2 />
          </Match>
        </Switch>
      </span>
      <div class="monitor-tool-text">
        <span class="monitor-tool-title">{title()}</span>
        <span class="monitor-tool-argument">
          <bdi>{props.argument}</bdi>
        </span>
      </div>
      <span class="monitor-tool-status">
        <StatusIcon status={MONITOR_TOOL_STATUS_TONE[props.status]} />
        <span>{outcome()}</span>
      </span>
    </div>
  );
}
