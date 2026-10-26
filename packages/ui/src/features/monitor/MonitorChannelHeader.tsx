/**
 * The header of a Monitor channel: its name, the Live pill, the agent icons with the agent count,
 * and the Canvas / Feed / Tasks switch. The switch is a `SlidingTabs.List`, so the caller puts the
 * header inside the `SlidingTabs.Root` that also holds the views.
 */

import { Button, Hash, SlidingTabs } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { StatusPill } from "./StatusPill";

export const MONITOR_CHANNEL_TABS = ["canvas", "feed", "tasks"] as const;
export type MonitorChannelTab = (typeof MONITOR_CHANNEL_TABS)[number];

const TAB_LABEL = {
  canvas: "monitor.tab.canvas",
  feed: "monitor.tab.feed",
  tasks: "monitor.tab.tasks",
} as const;

/** How many agent icons the header shows before the count. */
const AVATAR_LIMIT = 5;

export interface MonitorChannelHeaderAgent {
  id: string;
  name: string;
  avatar: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl">;
}

export interface MonitorChannelHeaderProps {
  name: string;
  /** Shows the Live pill. */
  live: boolean;
  /** The feed is paused: the pill says Paused in place of Live. */
  paused?: boolean | undefined;
  /** The channel has no activity: the pill says Idle in place of Live. */
  idle?: boolean | undefined;
  agents: readonly MonitorChannelHeaderAgent[];
  /** Opens the members of the channel. Without it, the icons are not a button. */
  onOpenMembers?: (() => void) | undefined;
  /** The views that can open now. The others show, and are off. */
  availableTabs?: readonly MonitorChannelTab[] | undefined;
  /** Wraps the agent icons in the members popover. Takes the place of `onOpenMembers` when given. */
  renderMembers?: ((avatars: JSX.Element) => JSX.Element) | undefined;
  /** More controls at the end of the row, such as Pause feed. */
  actions?: JSX.Element;
}

export function MonitorChannelHeader(props: MonitorChannelHeaderProps) {
  const { t } = useText();
  const available = (tab: MonitorChannelTab) => props.availableTabs?.includes(tab) ?? true;
  const avatars = () => (
    <>
      <span class="monitor-channel-avatars" aria-hidden="true">
        <For each={props.agents.slice(0, AVATAR_LIMIT)} keyed={(agent) => agent.id}>
          {(agent) => <AgentAvatar class="monitor-channel-avatar" agent={agent().avatar} />}
        </For>
      </span>
      <span class="monitor-channel-count">{t("monitor.channel.agents", { count: props.agents.length })}</span>
    </>
  );
  return (
    <header class="monitor-page-header monitor-channel-header">
      <Hash class="monitor-page-hash" aria-hidden="true" />
      <h1 class="monitor-page-title">{props.name}</h1>
      <Show when={props.live}>
        <Show
          when={props.paused}
          fallback={
            <Show when={props.idle} fallback={<StatusPill status="working" label={t("monitor.view.live")} />}>
              <StatusPill status="idle" label={t("monitor.agentStatus.idle")} />
            </Show>
          }
        >
          <StatusPill status="waiting" label={t("monitor.view.paused")} />
        </Show>
      </Show>
      <Show
        when={!props.renderMembers && props.onOpenMembers}
        fallback={
          props.renderMembers ? (
            props.renderMembers(avatars())
          ) : (
            <span class="monitor-channel-members">{avatars()}</span>
          )
        }
      >
        {(open) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="monitor-channel-members"
            aria-label={t("monitor.channel.members", { count: props.agents.length })}
            onClick={() => open()()}
          >
            {avatars()}
          </Button>
        )}
      </Show>
      <div class="monitor-channel-actions">
        <SlidingTabs.List class="monitor-channel-tabs" aria-label={t("monitor.tab.label")}>
          <For each={MONITOR_CHANNEL_TABS}>
            {(tab) => (
              <SlidingTabs.Trigger value={tab} disabled={!available(tab)}>
                {t(TAB_LABEL[tab])}
              </SlidingTabs.Trigger>
            )}
          </For>
        </SlidingTabs.List>
        {props.actions}
      </div>
    </header>
  );
}
