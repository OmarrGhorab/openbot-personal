/**
 * One agent in the Monitor sidebar: its icon, its name, a status line such as "Building pricing
 * section · 14m", and a status dot. The row is a button that selects the agent.
 */

import type { MonitorAgentStatus } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { MONITOR_STATUS_LABEL, MONITOR_STATUS_MOOD } from "./monitor-status";
import { monitorAgo, monitorSince } from "./monitor-time";
import { StatusDot } from "./StatusPill";

export interface AgentRowProps {
  agent: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl">;
  name: string;
  status: MonitorAgentStatus;
  /** What the agent does, such as its task title or its error. Without it, the row shows the status word. */
  detail?: string | null | undefined;
  /** When the status started, as an ISO time. An idle agent shows how long ago; the others how long since. */
  since?: string | null | undefined;
  /** The clock for `since`. Defaults to the time of the render. */
  now?: Date | undefined;
  selected?: boolean | undefined;
  onSelect: () => void;
}

export function AgentRow(props: AgentRowProps): JSX.Element {
  const { t } = useText();
  const statusWord = () => t(MONITOR_STATUS_LABEL[props.status]);
  const line = () => {
    const detail = props.detail?.trim() || statusWord();
    const since = props.since;
    if (!since) return detail;
    const now = props.now ?? new Date();
    const time = props.status === "idle" ? monitorAgo(since, now, t) : monitorSince(since, now, t);
    return t("monitor.agent.detail", { detail, time });
  };
  return (
    <Button
      type="button"
      variant="ghost"
      class="monitor-agent-row"
      data-status={props.status}
      data-selected={props.selected ? "" : undefined}
      data-avatar-hover=""
      aria-label={t("monitor.agent.label", { name: props.name, status: statusWord(), detail: line() })}
      aria-pressed={props.selected ? "true" : "false"}
      onClick={() => props.onSelect()}
    >
      <AgentAvatar class="monitor-agent-row-avatar" agent={props.agent} mood={MONITOR_STATUS_MOOD[props.status]} />
      <span class="monitor-row-copy">
        <span class="monitor-row-title">{props.name}</span>
        <span class="monitor-row-meta">{line()}</span>
      </span>
      <StatusDot status={props.status} class="monitor-agent-row-dot" />
    </Button>
  );
}
