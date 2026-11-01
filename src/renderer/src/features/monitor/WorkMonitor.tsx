import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Button, Hash, UsersRound } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, For, Show } from "solid-js";
import { TicketsPanel, type TicketsPanelProps } from "../tickets/TicketsPanel";
import { MonitorAgentPopup } from "./MonitorAgentPopup";
import { MonitorConversationDrawer } from "./MonitorConversationDrawer";
import { MonitorPane } from "./MonitorPane";
import { MonitorToolCallsDialog } from "./MonitorToolCallsDialog";
import { useMonitor } from "./monitor-context";
import { countMonitorChannel } from "./monitor-overview";

export interface WorkChannelsProps {
  /** The channels that the live view lists, as the channel list of the client has them. */
  channels: readonly ChannelSummary[];
  /** Opens the live view in place of the board. */
  onOpenLive: () => void;
}

/**
 * The channels part of the Work page's Agents panel. It replaces the Monitor sidebar: each channel with
 * its live counts, and All agents. A click opens the live view of the channel in the Work page.
 */
export function WorkChannels(props: WorkChannelsProps) {
  const { t } = useText();
  const monitor = useMonitor();
  const channels = createMemo(() =>
    props.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      ...countMonitorChannel(monitor.state.overview[channel.id]),
    })),
  );
  return (
    <section class="work-channels" aria-label={t("tickets.work.channels")}>
      <h4 class="work-channels-title">{t("tickets.work.channels")}</h4>
      <Button
        variant="ghost"
        size="sm"
        class="work-channel"
        onClick={() => {
          monitor.showAllAgents();
          props.onOpenLive();
        }}
      >
        <UsersRound aria-hidden="true" />
        <span class="work-channel-name">{t("tickets.work.allAgents")}</span>
        <span class="work-channel-count">{monitor.agents().length}</span>
      </Button>
      <Show when={channels().length === 0}>
        <p class="work-agent-line tickets-muted">{t("tickets.work.noChannels")}</p>
      </Show>
      <For each={channels()} keyed={(channel) => channel.id}>
        {(channel) => (
          <Button
            variant="ghost"
            size="sm"
            class="work-channel"
            title={t("tickets.work.channelCounts", {
              working: channel().working,
              waiting: channel().waiting,
              errors: channel().errors,
            })}
            onClick={() => {
              monitor.selectChannel(channel().id);
              props.onOpenLive();
            }}
          >
            <Hash aria-hidden="true" />
            <span class="work-channel-name" dir="auto">
              {channel().name}
            </span>
            <Show when={channel().working > 0}>
              <span class="work-live-dot" data-state="working" aria-hidden="true" />
            </Show>
            <Show when={channel().errors > 0}>
              <span class="work-live-dot" data-state="error" aria-hidden="true" />
            </Show>
            <span class="work-channel-count">{channel().agents}</span>
          </Button>
        )}
      </For>
    </section>
  );
}

export interface WorkTicketsPanelProps extends TicketsPanelProps {
  /** Whether the live data of this computer shows: the Work page on the local server. */
  live: boolean;
  /** The channels that the live view lists. */
  channels: readonly ChannelSummary[];
  /** Whether the live view replaces the board. */
  liveOpen: boolean;
  onLiveOpen: (open: boolean) => void;
}

/**
 * The Work page with the parts of the old Monitor: the channels and the status tabs in the Agents
 * panel, the agent popup with its current task, tool calls and thread, and the live view of a channel.
 */
export function WorkTicketsPanel(props: WorkTicketsPanelProps) {
  const monitor = useMonitor();
  /** The agents that have live details: the agents of the listed channels. */
  const detailAgents = createMemo(() => new Set(monitor.agents().map((agent) => agent.id)));
  return (
    <>
      <TicketsPanel
        serverId={props.serverId}
        hostName={props.hostName}
        onBack={props.onBack}
        agentsOpen={props.agentsOpen}
        onToggleAgents={props.onToggleAgents}
        liveView={props.live && props.liveOpen ? <MonitorPane /> : undefined}
        onCloseLive={() => props.onLiveOpen(false)}
        agentsExtra={
          props.live ? <WorkChannels channels={props.channels} onOpenLive={() => props.onLiveOpen(true)} /> : undefined
        }
        onAgentDetails={props.live ? monitor.selectAgent : undefined}
        detailAgentIds={props.live ? detailAgents() : undefined}
      />
      {/* The live view has its own popup and dialogs. */}
      <Show when={props.live && !props.liveOpen}>
        <MonitorAgentPopup />
        <MonitorToolCallsDialog />
        <MonitorConversationDrawer />
      </Show>
    </>
  );
}
