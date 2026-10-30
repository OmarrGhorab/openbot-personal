import type {
  BoardTicket,
  BoardTicketEvent,
  BoardTicketStatus,
  BoardTicketType,
  ConversationMessage,
} from "@openbot/contracts/ipc";
import { ArrowLeft, Button, IconButton, Input, PanelLeft, Plus, RefreshCw, UsersRound } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, createUniqueId, onSettled, Show, untrack } from "solid-js";
import { TicketDrawer } from "./TicketDrawer";
import { TicketsAgentPanel, type TicketsThreadControls } from "./TicketsAgentPanel";
import {
  TicketsAgentStrip,
  type TicketsBoardData,
  TicketsColumns,
  TicketsLanes,
  TicketsViewSwitch,
} from "./TicketsBoard";
import { TicketsEmptyState } from "./TicketsEmptyState";
import { type TicketNew, type TicketsAutopilot, TicketsNewDialog } from "./TicketsNewDialog";
import { PROVIDER_LABEL, type TicketsSyncControls, TicketsSyncDialog } from "./TicketsSyncDialog";
import type { TicketStart, TicketsView } from "./tickets-model";

export interface TicketsPageProps extends TicketsBoardData, TicketsThreadControls {
  /** The board lives on this computer. False on a joined server: the page then shows a notice. */
  available: boolean;
  /** False until the first ticket list arrives, so the empty notice does not flash. */
  loaded: boolean;
  hostName?: string | undefined;
  onBack?: (() => void) | undefined;
  agentsOpen?: boolean | undefined;
  onToggleAgents?: (() => void) | undefined;
  /** The ticket in the drawer. The consumer keeps it, because it loads the ticket's activity and thread. */
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string | null) => void;
  /** The activity of the selected ticket, oldest first. Null while it loads. */
  events: readonly BoardTicketEvent[] | null;
  /** The messages of the selected ticket's work thread. */
  messages: readonly ConversationMessage[];
  /** Adds a ticket. True when it was added. */
  onCreate: (ticket: TicketNew) => Promise<boolean>;
  /** Starts a ticket, a new one or one on the board. True when it started. */
  onStart: (start: TicketStart) => Promise<boolean>;
  onMove: (ticketId: string, status: BoardTicketStatus) => void;
  onAssign: (ticketId: string, agentId: string | null) => void;
  /** Sets the person's choice of type for the ticket. `null` clears it. */
  onSetType?: ((ticketId: string, type: BoardTicketType | null) => void) | undefined;
  onDelete: (ticketId: string) => void;
  /** Opens the ticket's work thread in its agent's chat. */
  onOpenThread?: ((ticket: BoardTicket) => void) | undefined;
  onOpenLink: (url: string) => void;
  /** Sends the text to the ticket's work thread. True when it went out. */
  onSteer: (ticket: BoardTicket, text: string) => Promise<boolean>;
  /**
   * Approves a ticket in Needs review. Without it, Approve moves the ticket to Done. A consumer where the
   * Reviewer merges (auto-merge on for the ticket's type) does the merge here.
   */
  onApprove?: ((ticket: BoardTicket) => void) | undefined;
  /** Sends the text to the ticket's work thread and moves the ticket back to Running. True when it went out. */
  onRequestChanges?: ((ticket: BoardTicket, text: string) => Promise<boolean>) | undefined;
  /** The sync with a connected ticket system. With no connected system, the page shows no sync control. */
  sync?: TicketsSyncControls | undefined;
  /** Autopilot while its switch is on. Absent: the New ticket dialog hides "Let autopilot work on it". */
  autopilot?: TicketsAutopilot | undefined;
  /** Opens the Raven Stack team page, with the ticket as its text when there is one. Absent where no team runs. */
  onOpenTeam?: ((ticket: BoardTicket | null) => void) | undefined;
}

/**
 * The Tickets page: the agent strip, the board or one lane for each agent, and beside them the drawer
 * of the selected ticket or the panel of the selected agent. New ticket adds a ticket to the backlog or
 * starts it now.
 */
export function TicketsPage(props: TicketsPageProps) {
  const { t } = useText();
  const headingId = createUniqueId();
  let heading: HTMLHeadingElement | undefined;
  const [view, setView] = createSignal<TicketsView>("board");
  const [agentId, setAgentId] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [syncOpen, setSyncOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  /** The board shows the tickets that match the search in their title, key or text. */
  const shown = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return props.tickets;
    return props.tickets.filter((ticket) =>
      [ticket.title, ticket.body, ticket.external?.key ?? ""].some((text) => text.toLowerCase().includes(needle)),
    );
  });
  const canSync = () => (props.sync?.state?.providers.length ?? 0) > 0;
  /**
   * The empty board's Sync button names the ticket system: the one the board syncs with, or the only one
   * connected. With several connected and none chosen yet it is plain "Sync". Null: nothing is connected.
   */
  const emptySyncLabel = () => {
    const state = props.sync?.state;
    if (!state || state.providers.length === 0) return null;
    const provider = state.target?.provider ?? (state.providers.length === 1 ? state.providers[0] : undefined);
    return provider
      ? t("tickets.emptyState.syncFrom", { provider: t(PROVIDER_LABEL[provider]) })
      : t("tickets.sync.open");
  };
  const agentsLabel = () =>
    t(props.agentsOpen ? "conversation.tasks.page.hideAgents" : "conversation.tasks.page.showAgents");
  const empty = () => props.loaded && props.tickets.length === 0;
  const selectedAgent = () => {
    const id = agentId();
    return id ? props.agents.find((agent) => agent.id === id) : undefined;
  };
  const selectedTicket = () => props.tickets.find((ticket) => ticket.id === props.selectedTicketId);
  const snapshotOf = (owner: string | null) => (owner ? props.snapshots[owner] : undefined);
  /** A second click on the selected agent closes its panel. A ticket drawer gives way to the panel. */
  const selectAgent = (id: string) => {
    setAgentId(agentId() === id ? null : id);
    props.onSelectTicket(null);
  };
  onSettled(() => {
    if (untrack(() => props.onBack)) heading?.focus();
  });

  return (
    <section class="tickets-page" aria-labelledby={headingId}>
      <div class="tickets-page-main">
        <header class="tickets-page-header">
          <Show when={props.onBack}>
            {(back) => (
              <IconButton variant="ghost" label={t("common.back")} data-cuelume-tap="navigate" onClick={() => back()()}>
                <ArrowLeft />
              </IconButton>
            )}
          </Show>
          <Show when={props.onToggleAgents}>
            {(toggle) => (
              <Button
                variant="ghost"
                type="button"
                class="header-panel-toggle side-panel-toggle"
                aria-label={agentsLabel()}
                title={agentsLabel()}
                aria-expanded={props.agentsOpen ? "true" : "false"}
                onClick={() => toggle()()}
              >
                <PanelLeft aria-hidden="true" class="size-[14px]" />
              </Button>
            )}
          </Show>
          <h2 id={headingId} ref={heading} tabindex={-1}>
            {t("tickets.title")}
            <Show when={props.hostName}>
              {(host) => (
                <>
                  {" "}
                  <span aria-hidden="true">/</span> <span>{host()}</span>
                </>
              )}
            </Show>
          </h2>
          <Show when={props.available && empty()}>
            <p class="tickets-page-subtitle tickets-muted">{t("tickets.empty.title")}</p>
          </Show>
          <Show when={props.available}>
            <div class="tickets-page-tools">
              <Input
                class="tickets-search"
                value={query()}
                placeholder={t("tickets.search")}
                aria-label={t("tickets.search")}
                onValueChange={setQuery}
              />
              <TicketsViewSwitch view={view()} onChange={setView} />
              <Show when={props.onOpenTeam}>
                {(openTeam) => (
                  <Button size="sm" variant="outline" onClick={() => openTeam()(null)}>
                    <UsersRound aria-hidden="true" />
                    {t("tickets.team.open")}
                  </Button>
                )}
              </Show>
              <Show when={canSync()}>
                <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)}>
                  <RefreshCw aria-hidden="true" />
                  {t("tickets.sync.open")}
                </Button>
              </Show>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" />
                {t("tickets.new")}
              </Button>
            </div>
          </Show>
        </header>
        <Show
          when={props.available}
          fallback={<TicketsNotice title={t("tickets.unavailable.title")} body={t("tickets.unavailable.body")} />}
        >
          <TicketsAgentStrip
            agents={props.agents}
            tickets={props.tickets}
            snapshots={props.snapshots}
            selectedAgentId={agentId()}
            onSelectAgent={selectAgent}
          />
          <div class="tickets-page-scroll">
            <Show when={!empty() && query().trim() !== "" && shown().length === 0}>
              <TicketsNotice title={t("tickets.search.none")} body={t("tickets.search.noneBody")} />
            </Show>
            {/* While the first list loads the board shows its empty columns, never the empty state. */}
            <Show
              when={!empty()}
              fallback={
                <TicketsEmptyState
                  syncLabel={emptySyncLabel()}
                  onNewTicket={() => setCreating(true)}
                  onSync={() => setSyncOpen(true)}
                  onCreate={props.onCreate}
                />
              }
            >
              <Show
                when={view() === "agents"}
                fallback={
                  <TicketsColumns
                    agents={props.agents}
                    tickets={shown()}
                    snapshots={props.snapshots}
                    selectedTicketId={props.selectedTicketId}
                    onSelectTicket={props.onSelectTicket}
                  />
                }
              >
                <TicketsLanes
                  agents={props.agents}
                  tickets={shown()}
                  snapshots={props.snapshots}
                  selectedTicketId={props.selectedTicketId}
                  onSelectTicket={props.onSelectTicket}
                  onSelectAgent={selectAgent}
                />
              </Show>
            </Show>
          </div>
        </Show>
      </div>
      <Show when={props.available}>
        {/* Keyed by the ticket ID: another ticket opens with an empty steer box. */}
        <Show
          when={props.selectedTicketId}
          keyed
          fallback={
            <Show when={selectedAgent()}>
              {(agent) => (
                <TicketsAgentPanel
                  agents={props.agents}
                  tickets={props.tickets}
                  snapshots={props.snapshots}
                  agent={agent()}
                  snapshot={props.snapshots[agent().id]}
                  onClose={() => setAgentId(null)}
                  onOpenTicket={props.onSelectTicket}
                  onStopThread={props.onStopThread}
                  onPauseThread={props.onPauseThread}
                  onResumeThread={props.onResumeThread}
                />
              )}
            </Show>
          }
        >
          <Show when={selectedTicket()}>
            {(ticket) => (
              <TicketDrawer
                ticket={ticket()}
                agents={props.agents}
                snapshot={snapshotOf(ticket().agentId)}
                events={props.events}
                messages={props.messages}
                onClose={() => props.onSelectTicket(null)}
                onStart={() => {
                  const owner = ticket().agentId;
                  if (owner) void props.onStart({ agentId: owner, ticketId: ticket().id });
                }}
                onMove={(status) => props.onMove(ticket().id, status)}
                onAssign={(owner) => props.onAssign(ticket().id, owner)}
                onSetType={props.onSetType ? (type) => props.onSetType?.(ticket().id, type) : undefined}
                onDelete={() => props.onDelete(ticket().id)}
                onOpenThread={props.onOpenThread ? () => props.onOpenThread?.(ticket()) : undefined}
                onRunTeam={props.onOpenTeam ? () => props.onOpenTeam?.(ticket()) : undefined}
                onOpenLink={props.onOpenLink}
                onSteer={(text) => props.onSteer(ticket(), text)}
                onApprove={() => (props.onApprove ? props.onApprove(ticket()) : props.onMove(ticket().id, "done"))}
                onRequestChanges={
                  props.onRequestChanges
                    ? (text) => props.onRequestChanges?.(ticket(), text) ?? Promise.resolve(false)
                    : undefined
                }
                tickets={props.tickets}
                onOpenTicket={(ticketId) => props.onSelectTicket(ticketId)}
              />
            )}
          </Show>
        </Show>
      </Show>
      <Show when={syncOpen() && canSync() ? props.sync : undefined}>
        {(sync) => <TicketsSyncDialog sync={sync()} onClose={() => setSyncOpen(false)} />}
      </Show>
      <Show when={creating()}>
        <TicketsNewDialog
          agents={props.agents}
          snapshots={props.snapshots}
          agentId={agentId()}
          autopilot={props.autopilot}
          onClose={() => setCreating(false)}
          onCreate={props.onCreate}
          onStart={props.onStart}
        />
      </Show>
    </section>
  );
}

function TicketsNotice(props: { title: string; body: string }) {
  return (
    <div class="tickets-notice">
      <h3>{props.title}</h3>
      <p class="tickets-muted">{props.body}</p>
    </div>
  );
}
