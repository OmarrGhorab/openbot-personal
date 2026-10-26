/**
 * One channel in the Monitor sidebar: its name, "5 agents · 2 working", and an unread badge. The row
 * is a button that opens the channel in the Monitor.
 */

import { Badge, Button, Hash } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";

/** What one channel row shows. The counts come from the Monitor snapshot of the channel. */
export interface MonitorChannelRowData {
  id: string;
  name: string;
  agents: number;
  working: number;
  waiting: number;
  errors: number;
  unreadCount: number;
}

export interface ChannelRowProps {
  channel: MonitorChannelRowData;
  selected?: boolean | undefined;
  onSelect: () => void;
}

export function ChannelRow(props: ChannelRowProps): JSX.Element {
  const { t, format } = useText();
  /** The most active state of the channel: working, then waiting, then errors, else idle. */
  const activity = () => {
    const channel = props.channel;
    if (channel.working > 0) return t("monitor.channel.working", { number: format.number(channel.working) });
    if (channel.waiting > 0) return t("monitor.channel.waiting", { number: format.number(channel.waiting) });
    if (channel.errors > 0) return t("monitor.channel.errors", { count: channel.errors });
    return t("monitor.channel.idle");
  };
  const meta = () =>
    t("monitor.channel.meta", {
      agents: t("monitor.channel.agents", { count: props.channel.agents }),
      activity: activity(),
    });
  return (
    <Button
      type="button"
      variant="ghost"
      class="monitor-channel-row"
      data-selected={props.selected ? "" : undefined}
      aria-pressed={props.selected ? "true" : "false"}
      onClick={() => props.onSelect()}
    >
      <Hash class="monitor-channel-row-icon" aria-hidden="true" />
      <span class="monitor-row-copy">
        <span class="monitor-row-title">{props.channel.name}</span>
        <span class="monitor-row-meta">{meta()}</span>
      </span>
      <Show when={props.channel.unreadCount > 0}>
        <Badge class="monitor-unread-badge" variant="default" aria-hidden="true">
          {format.number(Math.min(props.channel.unreadCount, 99))}
        </Badge>
        <span class="sr-only">{t("sidebar.channel.unread", { count: props.channel.unreadCount })}</span>
      </Show>
    </Button>
  );
}
