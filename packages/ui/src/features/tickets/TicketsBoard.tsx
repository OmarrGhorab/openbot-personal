import type { AgentTasksSnapshot, BoardTicket, BoardTicketStatus } from "@openbot/contracts/ipc";
import { Button, IconButton, Plus, SlidingTabs, Sparkles, Zap } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { TicketTypeChip } from "./TicketTypeChip";
import {
  autopilotRunning,
  boardThreads,
  columnTickets,
  filterTickets,
  hasQuickAdd,
  isTicketsView,
  laneTickets,
  runningThreads,
  sameTicketsFilter,
  shortTicketKey,
  TICKET_COLUMNS,
  TICKET_STATUS_LABEL,
  TICKET_STEP_LABEL,
  TICKET_STEPS,
  type TicketsAutopilot,
  type TicketsFilter,
  type TicketsView,
  ticketAgo,
  ticketEdge,
  ticketElapsed,
  ticketError,
  ticketProgress,
  ticketSteps,
  ticketsSummary,
  ticketThread,
} from "./tickets-model";

/** The agents and their work threads, as every part of the board reads them. */
export interface TicketsBoardData {
  agents: readonly AgentProfile[];
  tickets: readonly BoardTicket[];
  /** The work threads of each agent, by agent id. */
  snapshots: Readonly<Record<string, AgentTasksSnapshot>>;
  /** The time that the cards count from. The page passes a clock that ticks each minute. */
  now?: Date | undefined;
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

/**
 * The line under the title: "12 tickets · 2 running · 2 need your review". With Autopilot on, the
 * running count says how many tickets Raven works on.
 */
export function TicketsSummaryLine(props: { tickets: readonly BoardTicket[]; autopilot: TicketsAutopilot }) {
  const { t } = useText();
  const parts = () => {
    const counts = ticketsSummary(props.tickets);
    return [
      counts.total === 1 ? t("tickets.summary.ticket") : t("tickets.summary.tickets", { count: counts.total }),
      props.autopilot.enabled
        ? t("tickets.summary.ravenWorking", { count: autopilotRunning(props.tickets) })
        : t("tickets.summary.running", { count: counts.running }),
      counts.review === 1 ? t("tickets.summary.reviewOne") : t("tickets.summary.review", { count: counts.review }),
    ];
  };
  return <p class="tickets-summary">{parts().join(t("tickets.summary.separator"))}</p>;
}

/** The pill by the title while Autopilot is on: "Autopilot on · 1 of 2 slots". */
export function TicketsAutopilotPill(props: { tickets: readonly BoardTicket[]; autopilot: TicketsAutopilot }) {
  const { t } = useText();
  return (
    <Show when={props.autopilot.enabled}>
      <span class="tickets-autopilot-pill">
        <Zap aria-hidden="true" />
        {t("tickets.autopilot.on", { running: autopilotRunning(props.tickets), slots: props.autopilot.slots })}
      </span>
    </Show>
  );
}

function TicketsChip(props: {
  label: string;
  count: number;
  pressed: boolean;
  onPress: () => void;
  children?: JSX.Element;
}) {
  return (
    <TicketsPressable class="tickets-chip" pressed={props.pressed} onPress={props.onPress}>
      {props.children}
      <span class="tickets-chip-name">{props.label}</span>
      <span class="tickets-chip-count">{props.count}</span>
    </TicketsPressable>
  );
}

/**
 * The filter chips above the board: every agent, one chip for each agent with its ticket count, and the
 * unassigned tickets. A second click on a chip clears the filter. At the end, the running threads of all agents.
 */
export function TicketsFilterChips(
  props: TicketsBoardData & { filter: TicketsFilter | null; onFilter: (filter: TicketsFilter | null) => void },
) {
  const { t } = useText();
  const threads = () => boardThreads(props.agents, props.snapshots);
  const toggle = (filter: TicketsFilter) => props.onFilter(sameTicketsFilter(props.filter, filter) ? null : filter);
  const unassigned: TicketsFilter = { kind: "unassigned" };
  return (
    <div class="tickets-filters">
      <fieldset class="tickets-chips" aria-label={t("tickets.filter.label")}>
        <TicketsChip
          label={t("tickets.filter.all")}
          count={props.tickets.length}
          pressed={props.filter === null}
          onPress={() => props.onFilter(null)}
        />
        <For each={props.agents} keyed={(agent) => agent.id}>
          {(agent) => {
            const filter = (): TicketsFilter => ({ kind: "agent", agentId: agent().id });
            return (
              <TicketsChip
                label={agent().name}
                count={filterTickets(props.tickets, filter()).length}
                pressed={sameTicketsFilter(props.filter, filter())}
                onPress={() => toggle(filter())}
              >
                <AgentAvatar
                  agent={agent()}
                  mood={agentMood(props.snapshots[agent().id])}
                  class="tickets-chip-avatar"
                />
              </TicketsChip>
            );
          }}
        </For>
        <TicketsChip
          label={t("tickets.card.unassigned")}
          count={filterTickets(props.tickets, unassigned).length}
          pressed={sameTicketsFilter(props.filter, unassigned)}
          onPress={() => toggle(unassigned)}
        />
      </fieldset>
      <span class="tickets-threads" data-busy={threads().running > 0 ? "" : undefined}>
        <span class="tickets-threads-dot" aria-hidden="true" />
        {t("tickets.agent.threads", threads())}
      </span>
    </div>
  );
}

/** What the card of a ticket that waits for review does with its two buttons. Absent: the card shows none. */
export interface TicketReviewActions {
  onApprove: (ticketId: string) => void;
  /** Opens the request for changes. Only a ticket with a work thread offers it. */
  onRequestChanges: (ticketId: string) => void;
}

export interface TicketCardProps extends TicketsBoardData {
  ticket: BoardTicket;
  selected: boolean;
  onSelect: (ticketId: string) => void;
  /** The compact card of the lanes: no key in the top row. */
  compact?: boolean | undefined;
  review?: TicketReviewActions | undefined;
}

/**
 * One ticket on the board (Figma "Ticket card v2"): the type chip, the key and a short meta; the title;
 * the four steps with the stage and the live line; a failure banner; the agent and its live pill; and on
 * a ticket that waits for review, Approve and Changes. The card body is one button that opens the
 * drawer. The review buttons sit outside it, so they never open the drawer.
 */
export function TicketCard(props: TicketCardProps) {
  const { t } = useText();
  const agent = () => props.agents.find((candidate) => candidate.id === props.ticket.agentId);
  const snapshot = () => (props.ticket.agentId ? props.snapshots[props.ticket.agentId] : undefined);
  const thread = () => ticketThread(props.ticket, snapshot());
  const progress = () => ticketProgress(props.ticket, thread());
  const error = () => ticketError(props.ticket, thread());
  const steps = () => ticketSteps(props.ticket, props.tickets, thread());
  const edge = () => ticketEdge(props.ticket, thread());
  const now = () => props.now ?? new Date();
  const enteredStatus = () => props.ticket.statusTimes[props.ticket.status] ?? props.ticket.statusChangedAt;
  const meta = () =>
    props.ticket.status === "queued" && !props.ticket.taskId
      ? t("tickets.card.noThread")
      : ticketAgo(enteredStatus(), now(), t);
  const stage = () => {
    const view = steps();
    if (!view) return "";
    const total = TICKET_STEPS.length;
    if (view.state === "done")
      return t("tickets.step.count", { step: t(TICKET_STATUS_LABEL.done), current: total, total });
    const step = t(TICKET_STEP_LABEL[TICKET_STEPS[view.index] ?? "build"]);
    return view.state === "blocked"
      ? t("tickets.step.blocked", { step })
      : t("tickets.step.count", { step, current: view.index + 1, total });
  };
  /** The line under the stage: the live progress, the question, or what the ticket waits for. */
  const line = () => {
    const view = steps();
    if (view?.state === "waiting") return t("tickets.step.waiting");
    if (view?.state === "blocked" && props.ticket.status === "needs_review") {
      const question = thread()?.question?.text;
      if (question) return question;
      return error() === null ? t("tickets.step.teamDecision") : progress();
    }
    return progress();
  };
  /** The live pill: the stack and the time while it runs ("Raven · 14m"), or "Queued". */
  const live = (): { tone: "running" | "queued"; text: string } | null => {
    if (props.ticket.status === "queued") return { tone: "queued", text: t(TICKET_STATUS_LABEL.queued) };
    if (props.ticket.status !== "running") return null;
    const stack = props.ticket.teamJobId === null ? t(TICKET_STATUS_LABEL.running) : t("tickets.card.stackRaven");
    return { tone: "running", text: t("tickets.card.live", { stack, time: ticketElapsed(enteredStatus(), now(), t) }) };
  };
  const reviewing = () => (props.review && steps()?.state === "waiting" ? props.review : undefined);
  return (
    <div class="tickets-card" data-status={props.ticket.status} data-edge={edge() ?? undefined}>
      <TicketsPressable
        class="tickets-card-body"
        pressed={props.selected}
        onPress={() => props.onSelect(props.ticket.id)}
      >
        <span class="tickets-card-top">
          <TicketTypeChip type={props.ticket.type} />
          <Show when={props.compact ? undefined : props.ticket.external}>
            {(external) => (
              <span class="tickets-card-key" title={external().key}>
                {shortTicketKey(external().key)}
              </span>
            )}
          </Show>
          <span class="tickets-card-meta">{meta()}</span>
        </span>
        <span class="tickets-card-title">{props.ticket.title}</span>
        <Show when={steps()}>
          {(view) => (
            <span class="tickets-card-steps" data-state={view().state}>
              <span class="tickets-card-bars" aria-hidden="true">
                <For each={TICKET_STEPS}>
                  {(step) => {
                    const index = TICKET_STEPS.indexOf(step);
                    return (
                      <span
                        class="tickets-card-bar"
                        data-reached={index < view().index || view().state === "done" ? "" : undefined}
                        data-current={index === view().index && view().state !== "done" ? "" : undefined}
                      />
                    );
                  }}
                </For>
              </span>
              <span class="tickets-card-stage">{stage()}</span>
              <Show when={line()}>{(text) => <span class="tickets-card-live">{text()}</span>}</Show>
            </span>
          )}
        </Show>
        <Show when={steps() ? null : progress()}>{(text) => <span class="tickets-card-live">{text()}</span>}</Show>
        <Show when={error() !== null}>
          <span class="tickets-card-error">{error() || t("tickets.card.turnFailed")}</span>
        </Show>
        <span class="tickets-card-footer">
          <Show
            when={agent()}
            fallback={
              <span class="tickets-card-agent">
                <span class="tickets-card-auto" aria-hidden="true">
                  <Sparkles />
                </span>
                <span class="tickets-card-agent-name">{t("tickets.card.ravenPicks")}</span>
              </span>
            }
          >
            {(owner) => (
              <span class="tickets-card-agent">
                <AgentAvatar
                  agent={owner()}
                  mood={thread()?.state === "running" ? "working" : "idle"}
                  class="tickets-card-avatar"
                />
                <span class="tickets-card-agent-name">{owner().name}</span>
              </span>
            )}
          </Show>
          <Show when={live()}>
            {(pill) => (
              <span class="tickets-card-pill" data-tone={pill().tone}>
                <span class="tickets-card-pill-dot" aria-hidden="true" />
                {pill().text}
              </span>
            )}
          </Show>
        </span>
      </TicketsPressable>
      <Show when={reviewing()}>
        {(actions) => (
          <div class="tickets-card-actions">
            <Button size="sm" class="tickets-card-action" onClick={() => actions().onApprove(props.ticket.id)}>
              {t("tickets.card.approve")}
            </Button>
            <Show when={props.ticket.taskId}>
              <Button
                size="sm"
                variant="outline"
                class="tickets-card-action"
                onClick={() => actions().onRequestChanges(props.ticket.id)}
              >
                {t("tickets.card.changes")}
              </Button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

interface TicketsGridProps extends TicketsBoardData {
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string) => void;
  review?: TicketReviewActions | undefined;
  /** Raven Autopilot as the board shows it. Absent: off. */
  autopilot?: TicketsAutopilot | undefined;
  /** The ticket that Raven picks next, marked above its card while Autopilot is on. */
  nextTicketId?: string | undefined;
  /** The quick add button of Backlog and Queued. Absent: no button. */
  onQuickAdd?: ((status: BoardTicketStatus) => void) | undefined;
}

function TicketsColumn(props: TicketsGridProps & { status: BoardTicketStatus }) {
  const { t } = useText();
  const tickets = () => columnTickets(props.tickets, props.status);
  /** The marker shows only while Autopilot is on, above the ticket that Raven picks next. */
  const isNext = (ticketId: string) =>
    props.status === "backlog" && props.autopilot?.enabled === true && props.nextTicketId === ticketId;
  return (
    <section class="tickets-column" aria-label={t(TICKET_STATUS_LABEL[props.status])}>
      <header class="tickets-column-header">
        <span class="tickets-column-dot" data-status={props.status} aria-hidden="true" />
        <span class="tickets-column-name">{t(TICKET_STATUS_LABEL[props.status])}</span>
        <span class="tickets-column-count">{tickets().length}</span>
        <Show when={props.status === "done" && props.autopilot?.enabled && props.autopilot.autoMerge}>
          <span class="tickets-column-note">{t("tickets.autopilot.autoMerge")}</span>
        </Show>
        <Show when={hasQuickAdd(props.status) ? props.onQuickAdd : undefined}>
          {(add) => (
            <IconButton
              variant="ghost"
              class="tickets-column-add"
              label={t("tickets.column.add", { column: t(TICKET_STATUS_LABEL[props.status]) })}
              onClick={() => add()(props.status)}
            >
              <Plus />
            </IconButton>
          )}
        </Show>
      </header>
      <div class="tickets-column-list">
        <For
          each={tickets()}
          keyed={(ticket) => ticket.id}
          fallback={<p class="tickets-column-empty">{t("tickets.column.empty")}</p>}
        >
          {(ticket) => (
            <div class="tickets-column-item" data-next={isNext(ticket().id) ? "" : undefined}>
              <Show when={isNext(ticket().id)}>
                <p class="tickets-next">
                  <Zap aria-hidden="true" />
                  {t("tickets.autopilot.next")}
                </p>
              </Show>
              <TicketCard
                agents={props.agents}
                tickets={props.tickets}
                snapshots={props.snapshots}
                now={props.now}
                ticket={ticket()}
                selected={props.selectedTicketId === ticket().id}
                onSelect={props.onSelectTicket}
                review={props.review}
              />
            </div>
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
                now={props.now}
                review={props.review}
                autopilot={props.autopilot}
                nextTicketId={props.nextTicketId}
                onQuickAdd={props.onQuickAdd}
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
            now={props.now}
            review={props.review}
            autopilot={props.autopilot}
            nextTicketId={props.nextTicketId}
            onQuickAdd={props.onQuickAdd}
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
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      class={props.class}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed ? "true" : "false"}
      data-busy={props.busy ? "" : undefined}
      onClick={props.onPress}
    >
      {props.children}
    </Button>
  );
}
