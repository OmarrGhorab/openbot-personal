import { SlidingTabs } from "@openbot/ui";
import { AgentNodeCard } from "@openbot/ui/features/monitor/AgentNodeCard";
import { MONITOR_CHANNEL_TABS, MonitorChannelHeader } from "@openbot/ui/features/monitor/MonitorChannelHeader";
import { useText } from "@openbot/ui/text";
import { createMemo, For, Show } from "solid-js";
import { MonitorCanvas } from "./MonitorCanvas";
import { useMonitor } from "./monitor-context";

/** The views of a channel that open now. Feed and Tasks come with #24. */
const AVAILABLE_TABS = ["canvas"] as const;

/**
 * The main area of the Monitor page: the open channel with its header and canvas, or every agent.
 * The "Live now" filter applies to both.
 */
export function MonitorPane() {
  const { t } = useText();
  const monitor = useMonitor();
  const allAgents = () => monitor.state.view === "all-agents";
  const agents = createMemo(() => {
    const status = monitor.statusFilter();
    return monitor.agents().filter((agent) => status === null || agent.status === status);
  });
  const headerAgents = createMemo(() =>
    (monitor.state.snapshot?.agents ?? []).map((agent) => ({
      id: agent.id,
      name: agent.name,
      avatar: { avatarSeed: agent.avatarSeed, avatarHue: agent.avatarHue, avatarUrl: agent.avatarUrl },
    })),
  );
  const error = () => <Show when={monitor.state.error}>{(key) => <p class="monitor-page-note">{t(key())}</p>}</Show>;
  return (
    <section class="monitor-page" aria-label={t("monitor.sidebar.label")}>
      <Show
        when={allAgents()}
        fallback={
          <Show
            when={monitor.state.channelId !== null}
            fallback={
              <div class="monitor-page-body">
                {error()}
                <p class="monitor-page-note">{t("monitor.view.empty")}</p>
              </div>
            }
          >
            <SlidingTabs.Root
              class="monitor-channel"
              value={monitor.state.tab}
              onChange={(value) => {
                const tab = MONITOR_CHANNEL_TABS.find((entry) => entry === value);
                if (tab) monitor.setTab(tab);
              }}
            >
              <MonitorChannelHeader
                name={monitor.state.snapshot?.channelName ?? ""}
                live={monitor.state.snapshot !== null}
                agents={headerAgents()}
                availableTabs={AVAILABLE_TABS}
              />
              <div class="monitor-channel-body">
                {error()}
                <SlidingTabs.ContentSlot>
                  <SlidingTabs.Content value="canvas">
                    <MonitorCanvas />
                  </SlidingTabs.Content>
                </SlidingTabs.ContentSlot>
              </div>
            </SlidingTabs.Root>
          </Show>
        }
      >
        <header class="monitor-page-header">
          <h1 class="monitor-page-title">{t("monitor.view.allAgents")}</h1>
          <span class="monitor-page-count">{t("monitor.channel.agents", { count: monitor.agents().length })}</span>
        </header>
        <div class="monitor-page-body">
          {error()}
          <ul class="monitor-page-agents">
            <For each={agents()} keyed={(agent) => agent.id}>
              {(agent) => (
                <li>
                  <AgentNodeCard
                    agent={agent()}
                    name={agent().name}
                    task={agent().detail}
                    status={agent().status}
                    since={agent().since}
                    selected={monitor.state.selectedAgentId === agent().id}
                    onSelect={() => monitor.selectAgent(agent().id)}
                  />
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </section>
  );
}
