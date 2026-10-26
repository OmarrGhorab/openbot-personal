import type { ChannelSummary } from "@openbot/contracts/ipc";
import { MonitorSidebar } from "@openbot/ui/features/monitor/MonitorSidebar";
import { createMemo } from "solid-js";
import { useMonitor } from "./monitor-context";
import { countMonitorChannel } from "./monitor-overview";

export interface MonitorSidebarPaneProps {
  /** The channels the Monitor lists, as the channel list of the client has them. */
  channels: readonly ChannelSummary[];
  /** Opens the channel create dialog of the client. */
  onCreateChannel?: (() => void) | undefined;
  /** Opens the global search of the client. */
  onOpenSearch: () => void;
}

/** The Monitor sidebar on desktop and on the web: the shared sidebar with the counts of the Monitor context. */
export function MonitorSidebarPane(props: MonitorSidebarPaneProps) {
  const monitor = useMonitor();
  const channels = createMemo(() =>
    props.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      unreadCount: channel.unreadCount,
      ...countMonitorChannel(monitor.state.overview[channel.id]),
    })),
  );
  const agents = createMemo(() =>
    monitor.agents().map((agent) => ({
      id: agent.id,
      name: agent.name,
      avatar: { avatarSeed: agent.avatarSeed, avatarHue: agent.avatarHue, avatarUrl: agent.avatarUrl },
      status: agent.status,
      detail: agent.detail,
      since: agent.since,
    })),
  );
  const filter = () => {
    const status = monitor.statusFilter();
    return status === "working" || status === "waiting" || status === "error" ? status : null;
  };
  return (
    <MonitorSidebar
      counts={monitor.liveCounts()}
      filter={filter()}
      onFilter={monitor.toggleStatusFilter}
      updatedAt={monitor.updatedAt()}
      channels={channels()}
      activeChannelId={monitor.state.channelId}
      onSelectChannel={monitor.selectChannel}
      onCreateChannel={props.onCreateChannel}
      agents={agents()}
      agentTotal={agents().length}
      selectedAgentId={monitor.state.selectedAgentId}
      onSelectAgent={monitor.selectAgent}
      onAllAgents={monitor.showAllAgents}
      allAgentsOpen={monitor.state.view === "all-agents"}
      onOpenSearch={props.onOpenSearch}
    />
  );
}
