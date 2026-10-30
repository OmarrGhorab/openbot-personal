import {
  type AgentTasksSnapshot,
  BOARD_TICKET_TYPES,
  type BoardTicket,
  type BoardTicketEvent,
  type BoardTicketStatus,
  type BoardTicketType,
  type ConversationMessage,
  isBoardTicketType,
} from "@openbot/contracts/ipc";
import {
  Button,
  buttonVariants,
  CircleCheck,
  CircleDot,
  ConfirmDialog,
  DropdownMenu,
  ExternalLink,
  File,
  IconButton,
  LoaderCircle,
  Play,
  Textarea,
  Trash2,
  UsersRound,
  X,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";
import { TICKET_TYPE_LABEL, TicketTypeChip } from "./TicketTypeChip";
import {
  finishedTurns,
  latestPlan,
  TICKET_COLUMNS,
  TICKET_STATUS_LABEL,
  threadFiles,
  threadStateLabel,
  ticketError,
  ticketProgress,
  ticketThread,
  turnTokens,
} from "./tickets-model";

export interface TicketDrawerProps {
  ticket: BoardTicket;
  agents: readonly AgentProfile[];
  snapshot: AgentTasksSnapshot | undefined;
  /** The activity of the ticket, oldest first. Null while it loads. */
  events: readonly BoardTicketEvent[] | null;
  /** The messages of the ticket's work thread. Empty before the thread exists or loads. */
  messages: readonly ConversationMessage[];
  onClose: () => void;
  /** Starts the work of a ticket that has no thread yet, with its agent. */
  onStart: () => void;
  onMove: (status: BoardTicketStatus) => void;
  onAssign: (agentId: string | null) => void;
  /** The person's choice of type, which wins over detection. Without it, the drawer shows the chip only. */
  onSetType?: ((type: BoardTicketType | null) => void) | undefined;
  onDelete: () => void;
  /** Opens the ticket's work thread. Without it, the drawer has no button for the thread. */
  onOpenThread?: (() => void) | undefined;
  /** Opens the Raven Stack team page with this ticket as its text. Absent where no team runs. */
  onRunTeam?: (() => void) | undefined;
  onOpenLink: (url: string) => void;
  /** Sends the text to the ticket's work thread. True when it went out. */
  onSteer: (text: string) => Promise<boolean>;
  /** Every ticket of the board: the drawer of a team job lists its role tickets, a role ticket links its job. */
  tickets: readonly BoardTicket[];
  /** Opens the drawer of another ticket. */
  onOpenTicket: (ticketId: string) => void;
}

const UNASSIGNED = "";
const NO_TYPE = "";

/**
 * The detail of one ticket: the status stepper, the stats that have a source, the live activity, the
 * plan and the files of its thread, and a box that steers the thread.
 */
export function TicketDrawer(props: TicketDrawerProps) {
  const { t, format } = useText();
  const [draft, setDraft] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const agent = () => props.agents.find((candidate) => candidate.id === props.ticket.agentId);
  const thread = () => ticketThread(props.ticket, props.snapshot);
  const progress = () => ticketProgress(props.ticket, thread());
  const error = () => ticketError(props.ticket, thread());
  const plan = () => latestPlan(props.messages);
  const files = () => threadFiles(props.messages);
  const tokens = () => turnTokens(props.messages);
  const tokenTotal = () => tokens().reduce((sum, turn) => sum + turn.tokens, 0);
  const tokenPeak = () => Math.max(1, ...tokens().map((turn) => turn.tokens));
  const comments = () => (props.events ?? []).filter((event) => event.kind === "comment").length;
  const currentIndex = () => TICKET_COLUMNS.indexOf(props.ticket.status);
  const time = (iso: string) => format.date(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const statusName = (status: BoardTicketStatus | null) => (status ? t(TICKET_STATUS_LABEL[status]) : "");
  const agentName = (agentId: string) => props.agents.find((candidate) => candidate.id === agentId)?.name ?? agentId;
  const newestFirst = () => [...(props.events ?? [])].reverse();
  const agentOf = (agentId: string | null) => props.agents.find((candidate) => candidate.id === agentId);
  /** The role tickets of a team job's ticket, one for each role. Empty for any other ticket. */
  const roleTickets = () => {
    const jobId = props.ticket.teamJobId;
    if (jobId === null || props.ticket.teamRoleId !== null) return [];
    return props.tickets.filter((candidate) => candidate.teamJobId === jobId && candidate.teamRoleId !== null);
  };
  /** The team job's own ticket, for a role ticket. */
  const jobTicket = () => {
    const jobId = props.ticket.teamJobId;
    if (jobId === null || props.ticket.teamRoleId === null) return undefined;
    return props.tickets.find((candidate) => candidate.teamJobId === jobId && candidate.teamRoleId === null);
  };

  function eventText(event: BoardTicketEvent): string {
    switch (event.kind) {
      case "created":
        return t("tickets.event.created", { status: statusName(event.toStatus) });
      case "moved":
        return t("tickets.event.moved", { from: statusName(event.fromStatus), to: statusName(event.toStatus) });
      case "assigned":
        return event.text
          ? t("tickets.event.assigned", { name: agentName(event.text) })
          : t("tickets.event.unassigned");
      case "type_changed":
        return isBoardTicketType(event.text)
          ? t("tickets.event.typeChanged", { type: t(TICKET_TYPE_LABEL[event.text]) })
          : t("tickets.event.typeCleared");
      default:
        return event.text ?? "";
    }
  }

  function actorName(event: BoardTicketEvent): string {
    if (event.actor === "user") return t("tickets.actor.user");
    if (event.actor === "agent") return t("tickets.actor.agent");
    return t("tickets.actor.sync");
  }

  async function steer(): Promise<void> {
    const text = draft().trim();
    if (!text || sending()) return;
    setSending(true);
    const sent = await props.onSteer(text);
    setSending(false);
    if (sent) setDraft("");
  }

  return (
    <aside class="tickets-side" aria-label={props.ticket.title}>
      <header class="tickets-side-header">
        <h3>{props.ticket.title}</h3>
        <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <div class="tickets-side-scroll">
        <div class="tickets-actions">
          <DropdownMenu.Root placement="bottom-start" gutter={4}>
            <DropdownMenu.Trigger
              class={`${buttonVariants({ variant: "outline", size: "sm" })} tickets-drawer-agent`}
              aria-label={t("tickets.new.agent")}
            >
              <Show when={agent()} fallback={t("tickets.card.unassigned")}>
                {(owner) => (
                  <>
                    <AgentAvatar
                      agent={owner()}
                      mood={thread()?.state === "running" ? "working" : "idle"}
                      class="tickets-drawer-avatar"
                    />
                    {t("tickets.drawer.agent", { name: owner().name })}
                  </>
                )}
              </Show>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <DropdownMenu.RadioGroup
                  value={props.ticket.agentId ?? UNASSIGNED}
                  onChange={(value: string) => props.onAssign(value === UNASSIGNED ? null : value)}
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
          <Show when={props.onSetType} fallback={<TicketTypeChip type={props.ticket.type} />}>
            {(setType) => (
              <DropdownMenu.Root placement="bottom-start" gutter={4}>
                <DropdownMenu.Trigger
                  class={`${buttonVariants({ variant: "outline", size: "sm" })} tickets-drawer-type`}
                  aria-label={t("tickets.type.label")}
                >
                  <TicketTypeChip type={props.ticket.type} unset />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content>
                    <DropdownMenu.RadioGroup
                      value={props.ticket.type ?? NO_TYPE}
                      onChange={(value: string) => setType()(isBoardTicketType(value) ? value : null)}
                    >
                      <For each={BOARD_TICKET_TYPES}>
                        {(type) => (
                          <DropdownMenu.RadioItem value={type} closeOnSelect>
                            <TicketTypeChip type={type} />
                          </DropdownMenu.RadioItem>
                        )}
                      </For>
                      <DropdownMenu.RadioItem value={NO_TYPE} closeOnSelect>
                        {t("tickets.type.unset")}
                      </DropdownMenu.RadioItem>
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </Show>
          <Show when={!props.ticket.taskId}>
            <Button size="sm" disabled={!props.ticket.agentId} onClick={props.onStart}>
              <Play aria-hidden="true" />
              {t("tickets.new.start")}
            </Button>
          </Show>
          <Show when={props.onRunTeam}>
            {(runTeam) => (
              <Button variant="outline" size="sm" onClick={() => runTeam()()}>
                <UsersRound aria-hidden="true" />
                {t("tickets.drawer.runTeam")}
              </Button>
            )}
          </Show>
          <Show when={props.ticket.threadId ? props.onOpenThread : undefined}>
            {(open) => (
              <Button variant="outline" size="sm" onClick={() => open()()}>
                {t("tickets.drawer.openThread")}
              </Button>
            )}
          </Show>
          <Show when={props.ticket.external}>
            {(external) => (
              <Button variant="outline" size="sm" onClick={() => props.onOpenLink(external().url)}>
                <ExternalLink aria-hidden="true" />
                {t("tickets.drawer.openIssue")}
              </Button>
            )}
          </Show>
          <Show when={jobTicket()}>
            {(job) => (
              <Button variant="outline" size="sm" onClick={() => props.onOpenTicket(job().id)}>
                {t("tickets.drawer.openTeamJob")}
              </Button>
            )}
          </Show>
          <IconButton label={t("common.delete")} variant="destructive-ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden="true" />
          </IconButton>
        </div>
        <Show when={!props.ticket.taskId && !props.ticket.agentId}>
          <p class="tickets-muted">{t("tickets.new.needsAgent")}</p>
        </Show>

        <section class="tickets-section">
          <h4>{t("tickets.drawer.steps")}</h4>
          <ol class="tickets-stepper">
            <For each={TICKET_COLUMNS}>
              {(status) => {
                const index = TICKET_COLUMNS.indexOf(status);
                return (
                  <li
                    class="tickets-step"
                    data-status={status}
                    data-reached={index <= currentIndex() ? "" : undefined}
                    data-current={index === currentIndex() ? "" : undefined}
                  >
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-current={index === currentIndex() ? "step" : undefined}
                      disabled={index === currentIndex()}
                      onClick={() => props.onMove(status)}
                    >
                      {t(TICKET_STATUS_LABEL[status])}
                    </Button>
                    <Show when={props.ticket.statusTimes[status]}>
                      {(at) => <span class="tickets-step-time">{time(at())}</span>}
                    </Show>
                  </li>
                );
              }}
            </For>
          </ol>
        </section>

        <Show when={roleTickets().length > 0}>
          <section class="tickets-section">
            <h4>{t("tickets.drawer.roleTickets")}</h4>
            <ul class="tickets-list">
              <For each={roleTickets()} keyed={(role) => role.id}>
                {(role) => (
                  <li>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="tickets-role-ticket"
                      onClick={() => props.onOpenTicket(role().id)}
                    >
                      <Show when={agentOf(role().agentId)}>
                        {(owner) => (
                          <AgentAvatar
                            agent={owner()}
                            mood={role().status === "running" ? "working" : "idle"}
                            class="tickets-drawer-avatar"
                          />
                        )}
                      </Show>
                      <span class="tickets-role-ticket-title">{role().title}</span>
                      <span class="tickets-role-ticket-status">{t(TICKET_STATUS_LABEL[role().status])}</span>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <section class="tickets-section">
          <h4>{t("tickets.drawer.stats")}</h4>
          <div class="tickets-stats">
            <TicketStat label={t("tickets.drawer.inColumn")} value={time(props.ticket.statusChangedAt)} />
            <TicketStat label={t("tickets.drawer.created")} value={time(props.ticket.createdAt)} />
            <Show when={thread()}>
              {(current) => <TicketStat label={t("tickets.drawer.thread")} value={t(threadStateLabel(current()))} />}
            </Show>
            <Show when={props.messages.length > 0}>
              <TicketStat label={t("tickets.drawer.turns")} value={format.number(finishedTurns(props.messages))} />
            </Show>
            <Show when={tokens().length > 0}>
              <TicketStat label={t("tickets.drawer.tokens")} value={format.number(tokenTotal())} />
            </Show>
            <Show when={props.events !== null}>
              <TicketStat label={t("tickets.drawer.comments")} value={format.number(comments())} />
            </Show>
          </div>
        </section>

        <Show when={props.ticket.body.trim()}>
          {(body) => (
            <section class="tickets-section">
              <h4>{t("tickets.drawer.details")}</h4>
              <p class="tickets-body">{body()}</p>
            </section>
          )}
        </Show>

        <section class="tickets-section" aria-live="polite">
          <h4>{t("tickets.drawer.activity")}</h4>
          <Show when={progress()}>
            {(line) => (
              <p class="tickets-live">
                <LoaderCircle aria-hidden="true" />
                {line()}
              </p>
            )}
          </Show>
          <Show when={error() !== null}>
            <p class="tickets-card-error">{error() || t("tickets.card.turnFailed")}</p>
          </Show>
          <Show
            when={newestFirst().length > 0}
            fallback={<p class="tickets-muted">{t("tickets.drawer.activityEmpty")}</p>}
          >
            <ol class="tickets-list">
              <For each={newestFirst()} keyed={(event) => event.id}>
                {(event) => (
                  <li class="tickets-event">
                    <span class="tickets-event-actor">{actorName(event())}</span>
                    <span class="tickets-event-text">{eventText(event())}</span>
                    <span class="tickets-event-time">{time(event().createdAt)}</span>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </section>

        <Show when={plan()}>
          {(current) => (
            <section class="tickets-section">
              <h4>{t("tickets.drawer.plan")}</h4>
              <ol class="tickets-list">
                <For each={current().steps} keyed={(step) => step.id}>
                  {(step) => (
                    <li class="tickets-plan-step" data-status={step().status}>
                      <Show when={step().status === "completed"} fallback={<CircleDot aria-hidden="true" />}>
                        <CircleCheck aria-hidden="true" />
                      </Show>
                      <span>{step().status === "inProgress" ? (step().activeText ?? step().text) : step().text}</span>
                    </li>
                  )}
                </For>
              </ol>
            </section>
          )}
        </Show>

        <Show when={files().length > 0}>
          <section class="tickets-section">
            <h4>{t("tickets.drawer.files")}</h4>
            <ul class="tickets-list">
              <For each={files()} keyed={(file) => file.id}>
                {(file) => (
                  <li class="tickets-file">
                    <File aria-hidden="true" />
                    <span>{file().name}</span>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={tokens().length > 1}>
          <section class="tickets-section">
            <h4>{t("tickets.drawer.tokensChart")}</h4>
            <div class="tickets-tokens">
              <For each={tokens()} keyed={(turn) => turn.id}>
                {(turn) => (
                  <span
                    class="tickets-tokens-bar"
                    role="img"
                    aria-label={t("tickets.drawer.tokensTurn", {
                      turn: turn().turn,
                      tokens: format.number(turn().tokens),
                    })}
                    style={{ height: `${Math.max(4, (turn().tokens / tokenPeak()) * 100)}%` }}
                  />
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={props.ticket.taskId}>
          <form
            class="tickets-steer"
            onSubmit={(event) => {
              event.preventDefault();
              void steer();
            }}
          >
            <h4 class="tickets-stat-label">{t("tickets.drawer.steer")}</h4>
            <Textarea
              value={draft()}
              onValueChange={setDraft}
              rows={3}
              aria-label={t("tickets.drawer.steer")}
              placeholder={t("tickets.drawer.steerPlaceholder")}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void steer();
                }
              }}
            />
            <div class="tickets-steer-actions">
              <Button type="submit" size="sm" loading={sending()} disabled={!draft().trim()}>
                {t("tickets.drawer.send")}
              </Button>
            </div>
          </form>
        </Show>
      </div>
      <ConfirmDialog
        open={confirmDelete()}
        onCancel={() => setConfirmDelete(false)}
        title={t("tickets.drawer.deleteTitle")}
        description={t("tickets.drawer.deleteBody")}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          setConfirmDelete(false);
          props.onDelete();
        }}
      />
    </aside>
  );
}

function TicketStat(props: { label: string; value: string }) {
  return (
    <div class="tickets-stat">
      <span class="tickets-stat-label">{props.label}</span>
      <span class="tickets-stat-value">{props.value}</span>
    </div>
  );
}
