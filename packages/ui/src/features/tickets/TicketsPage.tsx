import type { BoardTicket, BoardTicketEvent, BoardTicketStatus, ConversationMessage } from "@openbot/contracts/ipc";
import {
  ArrowLeft,
  Button,
  buttonVariants,
  Dialog,
  DropdownMenu,
  Field,
  IconButton,
  Input,
  PanelLeft,
  Play,
  Plus,
  RefreshCw,
  Textarea,
  UsersRound,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, createUniqueId, For, onSettled, Show, untrack } from "solid-js";
import { TicketDrawer } from "./TicketDrawer";
import { TicketsAgentPanel, type TicketsThreadControls } from "./TicketsAgentPanel";
import {
  TicketsAgentStrip,
  type TicketsBoardData,
  TicketsColumns,
  TicketsLanes,
  TicketsViewSwitch,
} from "./TicketsBoard";
import { type TicketsSyncControls, TicketsSyncDialog } from "./TicketsSyncDialog";
import type { TicketStart, TicketsView } from "./tickets-model";

/** A ticket that the New ticket dialog adds to the backlog. */
export interface TicketNew {
  title: string;
  body: string;
  agentId: string | null;
}

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
  onDelete: (ticketId: string) => void;
  /** Opens the ticket's work thread in its agent's chat. */
  onOpenThread?: ((ticket: BoardTicket) => void) | undefined;
  onOpenLink: (url: string) => void;
  /** Sends the text to the ticket's work thread. True when it went out. */
  onSteer: (ticket: BoardTicket, text: string) => Promise<boolean>;
  /** The sync with a connected ticket system. With no connected system, the page shows no sync control. */
  sync?: TicketsSyncControls | undefined;
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
            <Show when={empty()}>
              <TicketsNotice title={t("tickets.empty.title")} body={t("tickets.empty.body")} />
            </Show>
            <Show when={!empty() && query().trim() !== "" && shown().length === 0}>
              <TicketsNotice title={t("tickets.search.none")} body={t("tickets.search.noneBody")} />
            </Show>
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
                onDelete={() => props.onDelete(ticket().id)}
                onOpenThread={props.onOpenThread ? () => props.onOpenThread?.(ticket()) : undefined}
                onRunTeam={props.onOpenTeam ? () => props.onOpenTeam?.(ticket()) : undefined}
                onOpenLink={props.onOpenLink}
                onSteer={(text) => props.onSteer(ticket(), text)}
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
          agentId={agentId()}
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

const UNASSIGNED = "";

/**
 * The New ticket dialog: a title, details and an agent. Add to backlog keeps the ticket for later;
 * Start now starts its work thread with the agent. The agent of an open agent panel is chosen first.
 */
function TicketsNewDialog(props: {
  agents: readonly AgentProfile[];
  agentId: string | null;
  onClose: () => void;
  onCreate: (ticket: TicketNew) => Promise<boolean>;
  onStart: (start: TicketStart) => Promise<boolean>;
}) {
  const { t } = useText();
  const [title, setTitle] = createSignal("");
  const [body, setBody] = createSignal("");
  const [agentId, setAgentId] = createSignal<string | null>(untrack(() => props.agentId));
  const [busy, setBusy] = createSignal<"add" | "start" | null>(null);
  const agent = () => props.agents.find((candidate) => candidate.id === agentId());
  const trimmed = () => title().trim();

  async function submit(start: boolean): Promise<void> {
    const name = trimmed();
    const owner = agentId();
    if (!name || busy() || (start && !owner)) return;
    setBusy(start ? "start" : "add");
    const done =
      start && owner
        ? await props.onStart({ agentId: owner, title: name, body: body().trim() })
        : await props.onCreate({ title: name, body: body().trim(), agentId: owner });
    setBusy(null);
    if (done) props.onClose();
  }

  return (
    <Dialog.Root
      open={true}
      onOpenChange={(open) => {
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content class="tickets-new" as="section">
            <header class="tickets-new-header">
              <Dialog.Title as="h2" class="tickets-new-title">
                {t("tickets.new")}
              </Dialog.Title>
              <Dialog.Description class="tickets-muted">{t("tickets.new.description")}</Dialog.Description>
            </header>
            <form
              class="tickets-new-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(false);
              }}
            >
              <Field label={t("tickets.new.name")} required>
                <Input value={title()} disabled={busy() !== null} onValueChange={setTitle} />
              </Field>
              <Field label={t("tickets.new.details")}>
                <Textarea
                  value={body()}
                  rows={4}
                  disabled={busy() !== null}
                  placeholder={t("tickets.new.detailsPlaceholder")}
                  onValueChange={setBody}
                />
              </Field>
              <div class="tickets-new-agent">
                <span class="tickets-stat-label">{t("tickets.new.agent")}</span>
                <DropdownMenu.Root placement="bottom-start" gutter={4}>
                  <DropdownMenu.Trigger
                    class={`${buttonVariants({ variant: "outline", size: "sm" })} tickets-drawer-agent`}
                    aria-label={t("tickets.new.agent")}
                    disabled={busy() !== null}
                  >
                    <Show when={agent()} fallback={t("tickets.card.unassigned")}>
                      {(owner) => (
                        <>
                          <AgentAvatar agent={owner()} class="tickets-drawer-avatar" />
                          {owner().name}
                        </>
                      )}
                    </Show>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="tickets-new-menu">
                      <DropdownMenu.RadioGroup
                        value={agentId() ?? UNASSIGNED}
                        onChange={(value: string) => setAgentId(value === UNASSIGNED ? null : value)}
                      >
                        <DropdownMenu.RadioItem value={UNASSIGNED} closeOnSelect>
                          {t("tickets.card.unassigned")}
                        </DropdownMenu.RadioItem>
                        <For each={props.agents} keyed={(option) => option.id}>
                          {(option) => (
                            <DropdownMenu.RadioItem value={option().id} closeOnSelect class="tickets-drawer-agent">
                              <AgentAvatar agent={option()} class="tickets-drawer-avatar" />
                              {option().name}
                            </DropdownMenu.RadioItem>
                          )}
                        </For>
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
              <Show when={!agentId()}>
                <p class="tickets-muted">{t("tickets.new.needsAgent")}</p>
              </Show>
              <footer class="tickets-new-actions">
                <Button type="button" variant="ghost" disabled={busy() !== null} onClick={props.onClose}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="outline"
                  loading={busy() === "add"}
                  disabled={!trimmed() || busy() !== null}
                >
                  {t("tickets.new.add")}
                </Button>
                <Button
                  type="button"
                  loading={busy() === "start"}
                  disabled={!trimmed() || !agentId() || busy() !== null}
                  onClick={() => void submit(true)}
                >
                  <Play aria-hidden="true" />
                  {t("tickets.new.start")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
