import type { AgentTask, AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { Activity, Button, IconButton, PanelRight } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import type { TicketsThreadControls } from "./TicketsAgentPanel";
import { agentMood, type TicketsBoardData } from "./TicketsBoard";
import {
  boardThreads,
  openThreads,
  type WorkAgentState,
  workAgentState,
  workAgentTicket,
  workLiveCounts,
} from "./tickets-model";

const STATE_LABEL = {
  working: "tickets.work.state.working",
  waiting: "tickets.work.state.waiting",
  error: "tickets.work.state.error",
  idle: "tickets.work.state.idle",
} as const;

/**
 * The live strip of the Work page: how many agents work, wait or failed, how many tickets wait for
 * review, and the running threads of every agent against their limit.
 */
export function WorkLiveStrip(props: TicketsBoardData) {
  const { t } = useText();
  const counts = () => workLiveCounts(props.agents, props.tickets, props.snapshots);
  const threads = () => boardThreads(props.agents, props.snapshots);
  const percent = () => (threads().limit > 0 ? Math.round((threads().running / threads().limit) * 100) : 0);
  return (
    <div class="work-live">
      <span class="work-live-label">{t("tickets.work.live")}</span>
      <span class="work-live-chip">
        <span class="work-live-dot" data-state="working" aria-hidden="true" />
        <strong>{counts().working}</strong> {t("tickets.work.state.working")}
      </span>
      <span class="work-live-chip">
        <span class="work-live-dot" data-state="waiting" aria-hidden="true" />
        <strong>{counts().waiting}</strong> {t("tickets.work.state.waiting")}
      </span>
      <span class="work-live-chip">
        <span class="work-live-dot" data-state="error" aria-hidden="true" />
        <strong>{counts().error}</strong> {t("tickets.work.state.error")}
      </span>
      <span class="work-live-chip">
        <span class="work-live-dot" data-state="review" aria-hidden="true" />
        <strong>{counts().review}</strong> {t("tickets.work.review")}
      </span>
      <span class="work-live-threads" title={t("tickets.agent.threadsHint", { limit: threads().limit })}>
        {t("tickets.work.threads")}
        <span class="work-live-meter" aria-hidden="true">
          <span class="work-live-meter-fill" style={{ width: `${percent()}%` }} />
        </span>
        {t("tickets.work.threadsCount", threads())}
      </span>
    </div>
  );
}

interface WorkAgentsPanelProps extends TicketsBoardData, TicketsThreadControls {
  onHide: () => void;
  onOpenTicket: (ticketId: string) => void;
  onSelectAgent: (agentId: string) => void;
  /** More content at the end of the panel, such as the channels list. */
  extra?: JSX.Element | undefined;
  /** Opens the live details of an agent: its current task, tool calls and thread. */
  onAgentDetails?: ((agentId: string) => void) | undefined;
  /** The agents that have live details. Absent: none. */
  detailAgentIds?: ReadonlySet<string> | undefined;
}

const STATE_FILTERS: readonly WorkAgentState[] = ["working", "waiting", "error", "idle"];

/**
 * The Agents panel at the side of the Work page. It replaces the Monitor grid: each agent with its live
 * state, the ticket it works on, and Pause, Resume or Stop for its current thread.
 */
export function WorkAgentsPanel(props: WorkAgentsPanelProps) {
  const { t } = useText();
  /** The status tab: only the agents in this state. Null shows every agent. */
  const [stateFilter, setStateFilter] = createSignal<WorkAgentState | null>(null);
  const shown = () => {
    const only = stateFilter();
    return only === null
      ? props.agents
      : props.agents.filter((agent) => workAgentState(props.snapshots[agent.id]) === only);
  };
  return (
    <aside class="work-agents" aria-label={t("tickets.work.agents")}>
      <header class="work-agents-header">
        <h3>{t("tickets.work.agents")}</h3>
        <Button variant="ghost" size="sm" onClick={props.onHide}>
          <PanelRight aria-hidden="true" />
          {t("tickets.work.hide")}
        </Button>
      </header>
      <fieldset class="work-agents-tabs" aria-label={t("tickets.work.statusFilter")}>
        <Button
          size="sm"
          variant={stateFilter() === null ? "secondary" : "ghost"}
          aria-pressed={stateFilter() === null ? "true" : "false"}
          onClick={() => setStateFilter(null)}
        >
          {t("tickets.filter.all")}
        </Button>
        <For each={STATE_FILTERS}>
          {(state) => (
            <Button
              size="sm"
              variant={stateFilter() === state ? "secondary" : "ghost"}
              aria-pressed={stateFilter() === state ? "true" : "false"}
              onClick={() => setStateFilter(stateFilter() === state ? null : state)}
            >
              <span class="work-live-dot" data-state={state} aria-hidden="true" />
              {t(STATE_LABEL[state])}
            </Button>
          )}
        </For>
      </fieldset>
      <div class="work-agents-list">
        <Show when={shown().length === 0}>
          <p class="work-agent-line tickets-muted">{t("tickets.work.noAgentsInState")}</p>
        </Show>
        <For each={shown()} keyed={(agent) => agent.id}>
          {(agent) => {
            const snapshot = (): AgentTasksSnapshot | undefined => props.snapshots[agent().id];
            const state = (): WorkAgentState => workAgentState(snapshot());
            const thread = (): AgentTask | undefined => openThreads(snapshot())[0];
            const ticket = () => workAgentTicket(props.tickets, agent().id);
            return (
              <section class="work-agent" data-state={state()}>
                <div class="work-agent-top">
                  <Button variant="ghost" class="work-agent-who" onClick={() => props.onSelectAgent(agent().id)}>
                    <AgentAvatar agent={agent()} mood={agentMood(snapshot())} class="work-agent-avatar" />
                    <span class="work-agent-name" dir="auto">
                      {agent().name}
                    </span>
                  </Button>
                  <span class="work-agent-state">
                    <span class="work-live-dot" data-state={state()} aria-hidden="true" />
                    {t(STATE_LABEL[state()])}
                  </span>
                  <Show
                    when={
                      props.onAgentDetails && props.detailAgentIds?.has(agent().id) ? props.onAgentDetails : undefined
                    }
                  >
                    {(open) => (
                      <IconButton
                        variant="ghost"
                        size="icon-sm"
                        label={t("tickets.work.details", { name: agent().name })}
                        onClick={() => open()(agent().id)}
                      >
                        <Activity />
                      </IconButton>
                    )}
                  </Show>
                </div>
                <Show
                  when={ticket()}
                  fallback={<p class="work-agent-line tickets-muted">{t("tickets.work.noTicket")}</p>}
                >
                  {(current) => (
                    <Button variant="ghost" class="work-agent-line" onClick={() => props.onOpenTicket(current().id)}>
                      <span dir="auto">{current().title}</span>
                    </Button>
                  )}
                </Show>
                <Show when={thread()?.state === "running" || thread()?.pausedAt ? thread() : undefined}>
                  {(current) => (
                    <div class="work-agent-actions">
                      <Show
                        when={current().pausedAt}
                        fallback={
                          <Button size="sm" variant="outline" onClick={() => props.onPauseThread(current())}>
                            {t("tickets.panel.pause")}
                          </Button>
                        }
                      >
                        <Button size="sm" variant="outline" onClick={() => props.onResumeThread(current())}>
                          {t("tickets.panel.resume")}
                        </Button>
                      </Show>
                      <Button size="sm" variant="outline" onClick={() => props.onStopThread(current())}>
                        {t("tickets.panel.stop")}
                      </Button>
                    </div>
                  )}
                </Show>
              </section>
            );
          }}
        </For>
      </div>
      {props.extra}
    </aside>
  );
}

/** The button that shows the Agents panel again after Hide. */
export function WorkAgentsShow(props: { onShow: () => void }) {
  const { t } = useText();
  return (
    <IconButton variant="ghost" label={t("tickets.work.showAgents")} onClick={props.onShow}>
      <PanelRight />
    </IconButton>
  );
}
