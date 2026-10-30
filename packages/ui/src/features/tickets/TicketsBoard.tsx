import type { AgentTasksSnapshot, BoardTicket, BoardTicketStatus } from "@openbot/contracts/ipc";
import { Button, SlidingTabs, TriangleAlert } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { TicketsProviderMark } from "./TicketsProviderMark";
import { TicketTypeChip } from "./TicketTypeChip";
import {
  columnTickets,
  isTicketsView,
  laneTickets,
  runningThreads,
  TICKET_COLUMNS,
  TICKET_STATUS_LABEL,
  type TicketsView,
  ticketError,
  ticketProgress,
  ticketThread,
} from "./tickets-model";

/** The agents and their work threads, as every part of the board reads them. */
export interface TicketsBoardData {
  agents: readonly AgentProfile[];
  tickets: readonly BoardTicket[];
  /** The work threads of each agent, by agent id. */
  snapshots: Readonly<Record<string, AgentTasksSnapshot>>;
}

/** An agent with a running work thread looks busy: its avatar turns its rings. */
export function agentMood(snapshot: AgentTasksSnapshot | undefined): "working" | "idle" {
  return runningThreads(snapshot) > 0 ? "working" : "idle";
}

/** The board view switch: the columns, or one lane for each agent. */
export function TicketsViewSwitch(props: { view: TicketsView; onChange: (view: TicketsView) => void }) {
  const { t } = useText();
  return (
    <SlidingTabs.Root
      value={props.view}
      onChange={(value: string) => {
        if (isTicketsView(value)) props.onChange(value);
      }}
    >
      <SlidingTabs.List aria-label={t("tickets.view.label")}>
        <SlidingTabs.Trigger value="board">{t("tickets.view.board")}</SlidingTabs.Trigger>
        <SlidingTabs.Trigger value="agents">{t("tickets.view.agents")}</SlidingTabs.Trigger>
      </SlidingTabs.List>
    </SlidingTabs.Root>
  );
}

/** "N of M threads running" for one agent. */
export function ThreadCount(props: { snapshot: AgentTasksSnapshot | undefined; class: string }) {
  const { t } = useText();
  return (
    <span class={props.class}>
      {t("tickets.agent.threads", { running: runningThreads(props.snapshot), limit: props.snapshot?.limit ?? 1 })}
    </span>
  );
}

/** The strip of agents above the board: each agent with "N of M threads running". A click opens its panel. */
export function TicketsAgentStrip(
  props: TicketsBoardData & { selectedAgentId: string | null; onSelectAgent: (agentId: string) => void },
) {
  const { t } = useText();
  return (
    <section class="tickets-strip" aria-label={t("tickets.strip.label")}>
      <For each={props.agents} keyed={(agent) => agent.id}>
        {(agent) => {
          const snapshot = () => props.snapshots[agent().id];
          return (
            <TicketsPressable
              class="tickets-strip-agent"
              busy={runningThreads(snapshot()) > 0}
              pressed={props.selectedAgentId === agent().id}
              onPress={() => props.onSelectAgent(agent().id)}
            >
              <AgentAvatar agent={agent()} mood={agentMood(snapshot())} class="tickets-strip-avatar" />
              <span class="tickets-strip-text">
                <span class="tickets-strip-name">{agent().name}</span>
                <ThreadCount snapshot={snapshot()} class="tickets-strip-count" />
              </span>
            </TicketsPressable>
          );
        }}
      </For>
    </section>
  );
}

/** One ticket on the board: its title, its agent, its live line and its failure. A click opens the drawer. */
export function TicketCard(
  props: TicketsBoardData & { ticket: BoardTicket; selected: boolean; onSelect: (ticketId: string) => void },
) {
  const { t } = useText();
  const agent = () => props.agents.find((candidate) => candidate.id === props.ticket.agentId);
  const snapshot = () => (props.ticket.agentId ? props.snapshots[props.ticket.agentId] : undefined);
  const thread = () => ticketThread(props.ticket, snapshot());
  const progress = () => ticketProgress(props.ticket, thread());
  const error = () => ticketError(props.ticket, thread());
  return (
    <TicketsPressable
      class="tickets-card"
      status={props.ticket.status}
      pressed={props.selected}
      onPress={() => props.onSelect(props.ticket.id)}
    >
      <Show when={props.ticket.type !== null || props.ticket.external !== null}>
        <span class="tickets-card-top">
          <TicketTypeChip type={props.ticket.type} />
          <Show when={props.ticket.external}>
            {(external) => (
              <span class="tickets-card-source">
                <TicketsProviderMark provider={external().provider} class="tickets-card-source-mark" />
                <span class="tickets-card-key">{external().key}</span>
              </span>
            )}
          </Show>
        </span>
      </Show>
      <span class="tickets-card-title">{props.ticket.title}</span>
      <Show when={progress()}>{(line) => <span class="tickets-card-progress">{line()}</span>}</Show>
      <Show when={error() !== null}>
        <span class="tickets-card-error">
          <TriangleAlert aria-hidden="true" />
          {error() || t("tickets.card.turnFailed")}
        </span>
      </Show>
      <span class="tickets-card-meta">
        <Show
          when={agent()}
          fallback={<span class="tickets-card-agent tickets-card-agent-none">{t("tickets.card.unassigned")}</span>}
        >
          {(owner) => (
            <span class="tickets-card-agent">
              <AgentAvatar
                agent={owner()}
                mood={thread()?.state === "running" ? "working" : "idle"}
                class="tickets-card-avatar"
              />
              <span>{owner().name}</span>
            </span>
          )}
        </Show>
      </span>
    </TicketsPressable>
  );
}

interface TicketsGridProps extends TicketsBoardData {
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string) => void;
}

function TicketsColumn(props: TicketsGridProps & { status: BoardTicketStatus }) {
  const { t } = useText();
  const tickets = () => columnTickets(props.tickets, props.status);
  return (
    <section class="tickets-column" aria-label={t(TICKET_STATUS_LABEL[props.status])}>
      <header class="tickets-column-header">
        <span class="tickets-column-dot" data-status={props.status} aria-hidden="true" />
        <span class="tickets-column-name">{t(TICKET_STATUS_LABEL[props.status])}</span>
        <span class="tickets-column-count">{tickets().length}</span>
      </header>
      <div class="tickets-column-list">
        <For
          each={tickets()}
          keyed={(ticket) => ticket.id}
          fallback={<p class="tickets-column-empty">{t("tickets.column.empty")}</p>}
        >
          {(ticket) => (
            <TicketCard
              agents={props.agents}
              tickets={props.tickets}
              snapshots={props.snapshots}
              ticket={ticket()}
              selected={props.selectedTicketId === ticket().id}
              onSelect={props.onSelectTicket}
            />
          )}
        </For>
      </div>
    </section>
  );
}

/** The five columns, Backlog to Done. */
export function TicketsColumns(props: TicketsGridProps) {
  return (
    <div class="tickets-columns">
      <For each={TICKET_COLUMNS}>{(status) => <TicketsColumn {...props} status={status} />}</For>
    </div>
  );
}

/** One lane for each agent, and one for the unassigned tickets when there are any. Each lane keeps the five columns. */
export function TicketsLanes(props: TicketsGridProps & { onSelectAgent: (agentId: string) => void }) {
  const { t } = useText();
  const unassigned = () => laneTickets(props.tickets, null);
  return (
    <div class="tickets-lanes">
      <For each={props.agents} keyed={(agent) => agent.id}>
        {(agent) => {
          const snapshot = () => props.snapshots[agent().id];
          return (
            <section class="tickets-lane" aria-label={agent().name}>
              <TicketsPressable class="tickets-lane-header" onPress={() => props.onSelectAgent(agent().id)}>
                <AgentAvatar agent={agent()} mood={agentMood(snapshot())} class="tickets-lane-avatar" />
                <span class="tickets-lane-name">{agent().name}</span>
                <ThreadCount snapshot={snapshot()} class="tickets-lane-count" />
              </TicketsPressable>
              <TicketsColumns
                agents={props.agents}
                snapshots={props.snapshots}
                tickets={laneTickets(props.tickets, agent().id)}
                selectedTicketId={props.selectedTicketId}
                onSelectTicket={props.onSelectTicket}
              />
            </section>
          );
        }}
      </For>
      <Show when={unassigned().length > 0}>
        <section class="tickets-lane" aria-label={t("tickets.card.unassigned")}>
          <div class="tickets-lane-header-static">
            <span class="tickets-lane-name">{t("tickets.card.unassigned")}</span>
          </div>
          <TicketsColumns
            agents={props.agents}
            snapshots={props.snapshots}
            tickets={unassigned()}
            selectedTicketId={props.selectedTicketId}
            onSelectTicket={props.onSelectTicket}
          />
        </section>
      </Show>
    </div>
  );
}

/**
 * A card that opens something. The shared Button keeps the press, the focus ring and the sound cue; the
 * card only lays out its own content.
 */
function TicketsPressable(props: {
  class: string;
  children: JSX.Element;
  onPress: () => void;
  pressed?: boolean;
  busy?: boolean;
  status?: BoardTicketStatus;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      class={props.class}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed ? "true" : "false"}
      data-busy={props.busy ? "" : undefined}
      data-status={props.status}
      onClick={props.onPress}
    >
      {props.children}
    </Button>
  );
}
