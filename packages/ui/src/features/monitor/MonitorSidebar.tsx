/**
 * The sidebar of the Monitor page: the search field, the "Live now" counts, the channels and the
 * agents. The counts filter the Monitor, a channel row opens that channel, and an agent row selects
 * the agent. The search field opens the app's global search; this sidebar has no search of its own.
 * On this computer, "Live now" also lists the running team jobs and their team roles.
 */

import type { MonitorAgentStatus } from "@openbot/contracts/ipc";
import { Button, Plus } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { SearchIcon } from "../sidebar/SidebarIcons";
import { AgentRow } from "./AgentRow";
import { ChannelRow, type MonitorChannelRowData } from "./ChannelRow";
import { MonitorTeamJobRow, type MonitorTeamJobRowData } from "./MonitorTeamJobRow";
import { monitorAgo } from "./monitor-time";
import { StatChip } from "./StatChip";

/** The statuses that "Live now" counts, in the order it shows them. */
export const MONITOR_LIVE_STATUSES = ["working", "waiting", "error"] as const satisfies readonly MonitorAgentStatus[];
export type MonitorLiveStatus = (typeof MONITOR_LIVE_STATUSES)[number];

/** One agent row of the sidebar. */
export interface MonitorSidebarAgent {
  id: string;
  name: string;
  avatar: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl">;
  status: MonitorAgentStatus;
  /** Its task title or its error. */
  detail: string | null;
  /** When the status started, as an ISO time. */
  since: string | null;
}

export interface MonitorSidebarProps {
  /** How many agents have each status now. */
  counts: Record<MonitorLiveStatus, number>;
  /** The status that filters the Monitor, or null. */
  filter: MonitorLiveStatus | null;
  /** Turns the filter on a status on, or off when it is on. */
  onFilter: (status: MonitorLiveStatus) => void;
  /** When the newest snapshot was made, as an ISO time. Null before the first one. */
  updatedAt: string | null;
  channels: readonly MonitorChannelRowData[];
  activeChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
  /** Opens the dialog that creates a channel. Absent where the user cannot create one. */
  onCreateChannel?: (() => void) | undefined;
  /** The agents the sidebar lists. */
  agents: readonly MonitorSidebarAgent[];
  /** How many agents there are in all, for "All n". */
  agentTotal: number;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  /** Opens the all-agents view. */
  onAllAgents: () => void;
  allAgentsOpen: boolean;
  /** Opens the global search. */
  onOpenSearch: () => void;
  /** The team jobs that "Live now" lists. Absent or empty: the Teams list does not show. */
  teams?: readonly MonitorTeamJobRowData[] | undefined;
  /** Opens the team page on a job. */
  onOpenTeamJob?: ((jobId: string) => void) | undefined;
  /** Opens the work thread of a team role, by the role key. */
  onOpenTeamRole?: ((jobId: string, roleKey: string) => void) | undefined;
  /** The clock for the times. Defaults to the time of the render. */
  now?: Date | undefined;
}

export function MonitorSidebar(props: MonitorSidebarProps): JSX.Element {
  const { t, format } = useText();
  const now = () => props.now ?? new Date();
  return (
    <aside class="sidebar panel-edge monitor-sidebar" aria-label={t("monitor.sidebar.label")}>
      <div class="sidebar-search-wrap">
        <Button
          variant="ghost"
          type="button"
          class="search-field sidebar-search-trigger"
          aria-label={t("conversation.globalSearch.title")}
          aria-haspopup="dialog"
          onClick={() => props.onOpenSearch()}
        >
          <SearchIcon />
          <span class="sidebar-search-placeholder">{t("common.search")}</span>
        </Button>
      </div>
      <div class="monitor-sidebar-scroll">
        <section class="monitor-sidebar-section" aria-labelledby="monitor-sidebar-live">
          <header class="monitor-sidebar-heading">
            <h2 id="monitor-sidebar-live">{t("monitor.sidebar.liveNow")}</h2>
            <Show when={props.updatedAt}>
              {(updatedAt) => (
                <span class="monitor-sidebar-updated" aria-live="polite">
                  {t("monitor.sidebar.updated", { time: monitorAgo(updatedAt(), now(), t) })}
                </span>
              )}
            </Show>
          </header>
          <div class="monitor-live-counts">
            <For each={MONITOR_LIVE_STATUSES}>
              {(status) => (
                <StatChip
                  status={status}
                  value={props.counts[status]}
                  pressed={props.filter === status}
                  onSelect={() => props.onFilter(status)}
                />
              )}
            </For>
          </div>
          <Show when={(props.teams?.length ?? 0) > 0}>
            <div class="monitor-sidebar-teams" role="group" aria-labelledby="monitor-sidebar-teams">
              <h3 id="monitor-sidebar-teams" class="monitor-sidebar-subheading">
                {t("monitor.sidebar.teams")}
              </h3>
              <ul class="monitor-sidebar-list">
                <For each={props.teams ?? []} keyed={(job) => job.id}>
                  {(job) => (
                    <li>
                      <MonitorTeamJobRow
                        job={job()}
                        onOpenJob={() => props.onOpenTeamJob?.(job().id)}
                        onOpenRole={(roleKey) => props.onOpenTeamRole?.(job().id, roleKey)}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        </section>
        <section class="monitor-sidebar-section" aria-labelledby="monitor-sidebar-channels">
          <header class="monitor-sidebar-heading">
            <h2 id="monitor-sidebar-channels">{t("monitor.sidebar.channels")}</h2>
            <Show when={props.onCreateChannel}>
              {(onCreate) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="monitor-sidebar-action"
                  aria-label={t("monitor.sidebar.newChannel")}
                  onClick={() => onCreate()()}
                >
                  <Plus aria-hidden="true" />
                </Button>
              )}
            </Show>
          </header>
          <Show
            when={props.channels.length > 0}
            fallback={<p class="monitor-sidebar-empty">{t("monitor.sidebar.noChannels")}</p>}
          >
            <ul class="monitor-sidebar-list">
              <For each={props.channels} keyed={(channel) => channel.id}>
                {(channel) => (
                  <li>
                    <ChannelRow
                      channel={channel()}
                      selected={!props.allAgentsOpen && props.activeChannelId === channel().id}
                      onSelect={() => props.onSelectChannel(channel().id)}
                    />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
        <section class="monitor-sidebar-section" aria-labelledby="monitor-sidebar-agents">
          <header class="monitor-sidebar-heading">
            <h2 id="monitor-sidebar-agents">{t("monitor.sidebar.agents")}</h2>
            <Show when={props.agentTotal > 0}>
              <Button
                type="button"
                variant="link"
                size="sm"
                class="monitor-sidebar-all"
                aria-label={t("monitor.sidebar.allAgentsLabel", { total: format.number(props.agentTotal) })}
                aria-pressed={props.allAgentsOpen ? "true" : "false"}
                onClick={() => props.onAllAgents()}
              >
                {t("monitor.sidebar.allAgents", { total: format.number(props.agentTotal) })}
              </Button>
            </Show>
          </header>
          <Show
            when={props.agents.length > 0}
            fallback={<p class="monitor-sidebar-empty">{t("monitor.sidebar.noAgents")}</p>}
          >
            <ul class="monitor-sidebar-list">
              <For each={props.agents} keyed={(agent) => agent.id}>
                {(agent) => (
                  <li>
                    <AgentRow
                      agent={agent().avatar}
                      name={agent().name}
                      status={agent().status}
                      detail={agent().detail}
                      since={agent().since}
                      now={now()}
                      selected={props.selectedAgentId === agent().id}
                      onSelect={() => props.onSelectAgent(agent().id)}
                    />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </div>
    </aside>
  );
}
