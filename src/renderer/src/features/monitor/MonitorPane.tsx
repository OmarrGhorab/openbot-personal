import { Hash } from "@openbot/ui";
import { AgentNodeCard } from "@openbot/ui/features/monitor/AgentNodeCard";
import { StatusPill } from "@openbot/ui/features/monitor/StatusPill";
import { useText } from "@openbot/ui/text";
import { createMemo, For, Show } from "solid-js";
import { useMonitor } from "./monitor-context";
import { type MonitorOverviewAgent, summarizeMonitorSnapshot } from "./monitor-overview";

/**
 * The main area of the Monitor page: the open channel, or every agent. Until the channel canvas
 * (#23) lands, it shows the agents of the view as cards. The "Live now" filter applies to both.
 */
export function MonitorPane() {
  const { t } = useText();
  const monitor = useMonitor();
  const allAgents = () => monitor.state.view === "all-agents";
  const agents = createMemo((): MonitorOverviewAgent[] => {
    if (allAgents()) {
      const status = monitor.statusFilter();
      return monitor.agents().filter((agent) => status === null || agent.status === status);
    }
    const snapshot = monitor.filtered();
    return snapshot ? summarizeMonitorSnapshot(snapshot).agents : [];
  });
  const title = () => (allAgents() ? t("monitor.view.allAgents") : (monitor.state.snapshot?.channelName ?? ""));
  return (
    <section class="monitor-page" aria-label={t("monitor.sidebar.label")}>
      <header class="monitor-page-header">
        <Show when={!allAgents()}>
          <Hash class="monitor-page-hash" aria-hidden="true" />
        </Show>
        <h1 class="monitor-page-title">{title()}</h1>
        <Show when={!allAgents() && monitor.state.snapshot}>
          <StatusPill status="working" label={t("monitor.view.live")} />
        </Show>
        <span class="monitor-page-count">
          {t("monitor.channel.agents", {
            count: allAgents() ? monitor.agents().length : (monitor.state.snapshot?.agents.length ?? 0),
          })}
        </span>
      </header>
      <div class="monitor-page-body">
        <Show when={monitor.state.error}>{(error) => <p class="monitor-page-note">{t(error())}</p>}</Show>
        <Show
          when={allAgents() || monitor.state.channelId !== null}
          fallback={<p class="monitor-page-note">{t("monitor.view.empty")}</p>}
        >
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
        </Show>
      </div>
    </section>
  );
}
