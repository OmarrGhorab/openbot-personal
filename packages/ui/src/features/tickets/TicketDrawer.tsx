import {
  type AgentTasksSnapshot,
  BOARD_TICKET_PHASES,
  BOARD_TICKET_TYPES,
  type BoardTicket,
  type BoardTicketEvent,
  type BoardTicketEvidence,
  type BoardTicketEvidencePhase,
  type BoardTicketPhase,
  type BoardTicketStatus,
  type BoardTicketType,
  boardTicketEventAgents,
  boardTicketPhaseSteps,
  boardTicketVerdicts,
  type ConversationMessage,
  isBoardTicketType,
  type RavenAutopilotDecision,
} from "@openbot/contracts/ipc";
import {
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  ConfirmDialog,
  DropdownMenu,
  File,
  IconButton,
  LoaderCircle,
  MessageCircle,
  Play,
  Send,
  Textarea,
  Trash2,
  X,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { TicketAutopilotDecision } from "./TicketAutopilotDecision";
import { TicketCommentBox, TicketEvidence } from "./TicketEvidence";
import { TICKET_TYPE_LABEL, TicketTypeChip } from "./TicketTypeChip";
import {
  relativeTime,
  TICKET_PROVIDER_LABEL,
  TICKET_STEP_LABEL,
  threadTokens,
  threadToolCalls,
  ticketStartedAt,
} from "./ticket-drawer-model";
import {
  latestPlan,
  TICKET_COLUMNS,
  TICKET_STATUS_LABEL,
  threadFiles,
  ticketError,
  ticketProgress,
  ticketThread,
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
  onOpenLink: (url: string) => void;
  /** Sends the text to the ticket's work thread. True when it went out. */
  onSteer: (text: string) => Promise<boolean>;
  /** Approves a ticket in Needs review: "Approve and move to Done". */
  onApprove: () => void;
  /**
   * Sends the text to the work thread and moves the ticket back to Running. True when it went out.
   * Absent: the review has no Request changes (a ticket with no work thread).
   */
  onRequestChanges?: ((text: string) => Promise<boolean>) | undefined;
  /** Every ticket of the board: the drawer of a team job lists its role tickets, a role ticket links its job. */
  tickets: readonly BoardTicket[];
  /** Opens the drawer of another ticket. */
  onOpenTicket: (ticketId: string) => void;
  /** Why Autopilot started the ticket's team job the way it did. Absent for work it did not start. */
  decision?: RavenAutopilotDecision | null | undefined;
  /** The ticket's evidence (#236). Absent where the board keeps none, such as a joined server. */
  evidence?: readonly BoardTicketEvidence[] | undefined;
  loadEvidenceImage?: ((evidenceId: string) => Promise<string | null>) | undefined;
  onOpenEvidence?: ((evidenceId: string) => void) | undefined;
  onAttachEvidence?: ((phase: BoardTicketEvidencePhase) => Promise<void>) | undefined;
  /** Adds the person's comment to the ticket's activity. True when it was saved. */
  onComment?: ((text: string) => Promise<boolean>) | undefined;
}

const UNASSIGNED = "";
const NO_TYPE = "";
/** The relative times of the drawer read the clock again this often. */
const CLOCK_MS = 30_000;

/** The names of the work phases (ticket 237). */
const PHASE_LABEL = {
  take: "tickets.phase.take",
  triage: "tickets.phase.triage",
  reproduce: "tickets.phase.reproduce",
  implement: "tickets.phase.implement",
  verify: "tickets.phase.verify",
  review: "tickets.phase.review",
  merge: "tickets.phase.merge",
  done: "tickets.phase.done",
} as const satisfies Record<BoardTicketPhase, string>;

function isPhase(value: string | null): value is BoardTicketPhase {
  return BOARD_TICKET_PHASES.some((phase) => phase === value);
}

/**
 * The detail of one ticket. The next action comes first: Open thread (or Start now) with Move to and
 * Delete, or the review banner with Approve and Request changes. Then the five status steps, the
 * details, the live activity, the plan ("What changed" in review), the files and the activity. The body
 * scrolls; the steer box stays at the bottom. In review, its button is Request changes.
 */
export function TicketDrawer(props: TicketDrawerProps) {
  const { t, format, sourceText } = useText();
  const [draft, setDraft] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  const clock = setInterval(() => setNow(Date.now()), CLOCK_MS);
  onCleanup(() => clearInterval(clock));
  let steerBox: HTMLTextAreaElement | undefined;

  const agent = () => props.agents.find((candidate) => candidate.id === props.ticket.agentId);
  const thread = () => ticketThread(props.ticket, props.snapshot);
  const progress = () => ticketProgress(props.ticket, thread());
  const error = () => ticketError(props.ticket, thread());
  const plan = () => latestPlan(props.messages);
  const files = () => threadFiles(props.messages);
  const toolCalls = () => threadToolCalls(props.messages);
  const tokens = () => threadTokens(props.messages);
  const reviewing = () => props.ticket.status === "needs_review";
  /** Request changes needs a work thread to send the text to. */
  const canRequestChanges = () => reviewing() && props.onRequestChanges !== undefined;
  const currentIndex = () => TICKET_COLUMNS.indexOf(props.ticket.status);
  const time = (iso: string) => format.date(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const ago = (iso: string) => relativeTime(format.locale, iso, now());
  const agoShort = (iso: string) => relativeTime(format.locale, iso, now(), "narrow");
  const statusName = (status: BoardTicketStatus | null) => (status ? t(TICKET_STATUS_LABEL[status]) : "");
  const agentName = (agentId: string) => props.agents.find((candidate) => candidate.id === agentId)?.name ?? agentId;
  const eventAgents = createMemo(() => boardTicketEventAgents(props.events ?? []));
  const newestFirst = () => [...(props.events ?? [])].reverse();
  /** The newest review verdict (ticket 239), or undefined. */
  const lastVerdict = createMemo(() => boardTicketVerdicts(props.events ?? []).at(-1));
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
  const usage = () => {
    const parts: string[] = [];
    if (toolCalls() > 0) parts.push(t("tickets.drawer.toolCalls", { count: toolCalls() }));
    if (tokens() > 0) parts.push(t("tickets.drawer.tokenCount", { tokens: format.compact(tokens()) }));
    return parts.join(" · ");
  };
  /** The first line of the review banner: who finished, with the tool calls and the changed files when known. */
  const reviewSummary = () => {
    const owner = agent();
    if (!owner || toolCalls() === 0) return t("tickets.drawer.review.ready");
    const calls = t("tickets.drawer.toolCalls", { count: toolCalls() });
    if (files().length === 0) return t("tickets.drawer.review.finishedNoFiles", { name: owner.name, calls });
    return t("tickets.drawer.review.finished", {
      name: owner.name,
      calls,
      files: t("tickets.drawer.fileCount", { count: files().length }),
    });
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
      case "verdict": {
        const verdict = boardTicketVerdicts([event])[0];
        return verdict
          ? t("tickets.event.verdict", { verdict: verdict.verdict, sha: verdict.headSha.slice(0, 7) })
          : "";
      }
      case "phase":
        return isPhase(event.text) ? t("tickets.event.phase", { phase: t(PHASE_LABEL[event.text]) }) : "";
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
    if (event.actor === "agent") {
      const atTheTime = eventAgents().get(event.id);
      const owner = atTheTime === undefined ? agent() : agentOf(atTheTime);
      return owner?.name ?? t("tickets.actor.agent");
    }
    return t("tickets.actor.sync");
  }

  /** Sends the steer box: in review it requests changes, otherwise it steers the thread. */
  async function send(): Promise<void> {
    const text = draft().trim();
    if (!text || sending()) return;
    const request = canRequestChanges() ? props.onRequestChanges : undefined;
    setSending(true);
    const sent = request ? await request(text) : await props.onSteer(text);
    setSending(false);
    if (sent) setDraft("");
  }

  /** Request changes in the banner sends the comment when there is one; otherwise it asks for one. */
  function requestChanges(): void {
    if (draft().trim()) void send();
    else steerBox?.focus();
  }

  const moveMenu = () => (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger class={`${buttonVariants({ variant: "outline", size: "sm" })} ticket-drawer-move`}>
        <ChevronDown aria-hidden="true" />
        {t("tickets.drawer.moveTo")}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <For each={TICKET_COLUMNS}>
            {(status) => (
              <DropdownMenu.Item disabled={status === props.ticket.status} onSelect={() => props.onMove(status)}>
                {t(TICKET_STATUS_LABEL[status])}
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  return (
    <aside class="tickets-side ticket-drawer" aria-label={props.ticket.title}>
      <header class="ticket-drawer-header">
        <div class="ticket-drawer-meta">
          <Show when={props.ticket.external}>
            {(external) => <span class="ticket-drawer-key">{external().key}</span>}
          </Show>
          <span class="ticket-drawer-pill" data-status={props.ticket.status}>
            <span class="ticket-drawer-pill-dot" aria-hidden="true" />
            {t(TICKET_STATUS_LABEL[props.ticket.status])}
          </span>
          <span class="ticket-drawer-spacer" />
          <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
        <h3 class="ticket-drawer-title" dir="auto">
          {props.ticket.title}
        </h3>
      </header>

      <div class="ticket-drawer-body">
        <Show when={reviewing()}>
          <section class="ticket-drawer-review" aria-label={t("tickets.drawer.review.title")}>
            <h4 class="ticket-drawer-review-title">{t("tickets.drawer.review.title")}</h4>
            <p class="ticket-drawer-review-text">
              {reviewSummary()} {t("tickets.drawer.review.check")}
            </p>
            <div class="ticket-drawer-review-actions">
              <Button size="sm" onClick={props.onApprove}>
                <Check aria-hidden="true" />
                {t("tickets.drawer.approve")}
              </Button>
              <Show when={canRequestChanges()}>
                <Button size="sm" variant="outline" loading={sending()} onClick={requestChanges}>
                  {t("tickets.drawer.requestChanges")}
                </Button>
              </Show>
            </div>
          </section>
        </Show>

        <div class="ticket-drawer-actions">
          <Show when={props.ticket.threadId ? props.onOpenThread : undefined}>
            {(open) => (
              <Button
                size="sm"
                variant={reviewing() ? "outline" : "default"}
                class="ticket-drawer-primary"
                onClick={() => open()()}
              >
                <MessageCircle aria-hidden="true" />
                {t("tickets.drawer.openThread")}
              </Button>
            )}
          </Show>
          <Show when={!props.ticket.taskId && !props.ticket.threadId && props.ticket.teamJobId === null}>
            <Button size="sm" class="ticket-drawer-primary" disabled={!props.ticket.agentId} onClick={props.onStart}>
              <Play aria-hidden="true" />
              {t("tickets.new.start")}
            </Button>
          </Show>
          <Show when={jobTicket()}>
            {(job) => (
              <Button variant="outline" size="sm" onClick={() => props.onOpenTicket(job().id)}>
                {t("tickets.drawer.openTeamJob")}
              </Button>
            )}
          </Show>
          {moveMenu()}
          <IconButton label={t("common.delete")} variant="outline" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden="true" />
          </IconButton>
        </div>
        <Show when={!props.ticket.taskId && !props.ticket.agentId && props.ticket.teamJobId === null}>
          <p class="tickets-muted">{t("tickets.new.needsAgent")}</p>
        </Show>

        <Show when={props.decision}>{(decision) => <TicketAutopilotDecision decision={decision()} />}</Show>

        <ol class="ticket-drawer-steps" aria-label={t("tickets.drawer.steps")}>
          <For each={TICKET_COLUMNS}>
            {(status) => {
              const index = TICKET_COLUMNS.indexOf(status);
              const at = () => {
                const entered = props.ticket.statusTimes[status];
                return entered ? time(entered) : undefined;
              };
              return (
                <li
                  class="ticket-drawer-step"
                  data-status={status}
                  data-reached={index < currentIndex() ? "" : undefined}
                  data-current={index === currentIndex() ? "" : undefined}
                  aria-current={index === currentIndex() ? "step" : undefined}
                  title={at()}
                >
                  {t(TICKET_STEP_LABEL[status])}
                </li>
              );
            }}
          </For>
        </ol>

        <Show when={props.ticket.phase}>
          {(phase) => {
            const steps = () => boardTicketPhaseSteps(props.ticket.type);
            const at = () => steps().indexOf(phase());
            return (
              <ol class="ticket-drawer-steps ticket-drawer-phases" aria-label={t("tickets.drawer.phases")}>
                <For each={steps()}>
                  {(step) => {
                    const index = () => steps().indexOf(step);
                    return (
                      <li
                        class="ticket-drawer-step"
                        data-reached={index() < at() ? "" : undefined}
                        data-current={index() === at() ? "" : undefined}
                        aria-current={index() === at() ? "step" : undefined}
                      >
                        {t(PHASE_LABEL[step])}
                      </li>
                    );
                  }}
                </For>
              </ol>
            );
          }}
        </Show>

        <Show when={lastVerdict()}>
          {(verdict) => (
            <section class="ticket-drawer-section ticket-drawer-verdict" data-verdict={verdict().verdict}>
              <h4 class="ticket-drawer-heading">{t("tickets.drawer.verdict")}</h4>
              <p>
                <strong>{verdict().verdict}</strong>{" "}
                {t("tickets.drawer.verdictBy", {
                  name: agentOf(verdict().reviewerId)?.name ?? t("tickets.actor.agent"),
                  sha: verdict().headSha.slice(0, 7),
                })}
              </p>
              <Show when={verdict().notes}>
                <p class="tickets-muted" dir="auto">
                  {verdict().notes}
                </p>
              </Show>
            </section>
          )}
        </Show>

        <Show when={roleTickets().length > 0}>
          <section class="ticket-drawer-section">
            <h4 class="ticket-drawer-heading">{t("tickets.drawer.roleTickets")}</h4>
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

        <section class="ticket-drawer-section">
          <h4 class="ticket-drawer-heading">{t("tickets.drawer.details")}</h4>
          <dl class="ticket-drawer-details">
            <div class="ticket-drawer-row">
              <dt>{t("tickets.new.agent")}</dt>
              <dd>
                <DropdownMenu.Root placement="bottom-start" gutter={4}>
                  <DropdownMenu.Trigger
                    class={`${buttonVariants({ variant: "ghost", size: "xs" })} ticket-drawer-agent`}
                    aria-label={t("tickets.new.agent")}
                  >
                    <Show when={agent()} fallback={t("tickets.card.unassigned")}>
                      {(owner) => (
                        <>
                          <AgentAvatar
                            agent={owner()}
                            mood={thread()?.state === "running" ? "working" : "idle"}
                            class="ticket-drawer-avatar"
                          />
                          {owner().name}
                        </>
                      )}
                    </Show>
                    <ChevronDown aria-hidden="true" class="ticket-drawer-chevron" />
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
              </dd>
            </div>
            <div class="ticket-drawer-row">
              <dt>{t("tickets.type.label")}</dt>
              <dd>
                <Show
                  when={props.onSetType}
                  fallback={
                    <Show when={props.ticket.type} fallback={t("tickets.type.unset")}>
                      <TicketTypeChip type={props.ticket.type} />
                    </Show>
                  }
                >
                  {(setType) => (
                    <DropdownMenu.Root placement="bottom-start" gutter={4}>
                      <DropdownMenu.Trigger
                        class={`${buttonVariants({ variant: "ghost", size: "xs" })} ticket-drawer-agent`}
                        aria-label={t("tickets.type.label")}
                      >
                        <TicketTypeChip type={props.ticket.type} unset />
                        <ChevronDown aria-hidden="true" class="ticket-drawer-chevron" />
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
              </dd>
            </div>
            <div class="ticket-drawer-row">
              <dt>{t("tickets.drawer.source")}</dt>
              <dd>
                <Show when={props.ticket.external} fallback={t("tickets.drawer.sourceLocal")}>
                  {(external) => (
                    <Button
                      variant="link"
                      size="xs"
                      class="ticket-drawer-link"
                      onClick={() => props.onOpenLink(external().url)}
                    >
                      {t("tickets.drawer.sourceExternal", {
                        provider: t(TICKET_PROVIDER_LABEL[external().provider]),
                        key: external().key,
                      })}
                    </Button>
                  )}
                </Show>
              </dd>
            </div>
            <div class="ticket-drawer-row">
              <dt>{t("tickets.drawer.started")}</dt>
              <dd title={time(ticketStartedAt(props.ticket))}>{ago(ticketStartedAt(props.ticket))}</dd>
            </div>
            <Show when={props.ticket.workFolder}>
              {(folder) => (
                <div class="ticket-drawer-row">
                  <dt>{t("tickets.drawer.folder")}</dt>
                  <dd class="ticket-drawer-code" dir="ltr" title={folder()}>
                    {folder()}
                  </dd>
                </div>
              )}
            </Show>
            <Show when={props.ticket.worktree}>
              {(worktree) => (
                <>
                  <div class="ticket-drawer-row">
                    <dt>{t("tickets.drawer.worktree")}</dt>
                    <dd class="ticket-drawer-code" dir="ltr" title={worktree().path}>
                      {worktree().path}
                    </dd>
                  </div>
                  <div class="ticket-drawer-row">
                    <dt>{t("tickets.drawer.branch")}</dt>
                    <dd class="ticket-drawer-code" dir="ltr">
                      {worktree().branch}
                    </dd>
                  </div>
                </>
              )}
            </Show>
            <Show when={usage()}>
              {(line) => (
                <div class="ticket-drawer-row">
                  <dt>{t("tickets.drawer.usage")}</dt>
                  <dd>{line()}</dd>
                </div>
              )}
            </Show>
          </dl>
          <Show when={props.ticket.body.trim()}>{(body) => <p class="tickets-body">{body()}</p>}</Show>
        </section>

        <Show when={progress() || error() !== null}>
          <section class="ticket-drawer-section" aria-live="polite">
            <h4 class="ticket-drawer-heading">{t("tickets.drawer.liveActivity")}</h4>
            <Show when={progress()}>
              {(line) => (
                <p class="ticket-drawer-live">
                  <LoaderCircle aria-hidden="true" />
                  <span>{line()}</span>
                </p>
              )}
            </Show>
            <Show when={error() !== null}>
              <p class="ticket-drawer-error">{sourceText(error() ?? "") || t("tickets.card.turnFailed")}</p>
            </Show>
          </section>
        </Show>

        <Show when={plan()}>
          {(current) => (
            <section class="ticket-drawer-section">
              <h4 class="ticket-drawer-heading">
                {reviewing() ? t("tickets.drawer.whatChanged") : t("tickets.drawer.plan")}
              </h4>
              <ol class="ticket-drawer-plan">
                <For each={current().steps} keyed={(step) => step.id}>
                  {(step) => (
                    <li class="ticket-drawer-plan-step" data-status={step().status}>
                      <span class="ticket-drawer-plan-box" aria-hidden="true">
                        <Show when={step().status === "completed"}>
                          <Check />
                        </Show>
                      </span>
                      <span>{step().status === "inProgress" ? (step().activeText ?? step().text) : step().text}</span>
                    </li>
                  )}
                </For>
              </ol>
            </section>
          )}
        </Show>

        <Show when={files().length > 0}>
          <section class="ticket-drawer-section">
            <h4 class="ticket-drawer-heading">{t("tickets.drawer.files")}</h4>
            <ul class="ticket-drawer-files">
              <For each={files()} keyed={(file) => file.id}>
                {(file) => (
                  <li class="ticket-drawer-file">
                    <File aria-hidden="true" />
                    <span>{file().name}</span>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={props.evidence}>
          {(evidence) => (
            <TicketEvidence
              evidence={evidence()}
              loadImage={props.loadEvidenceImage}
              onOpen={props.onOpenEvidence}
              onAttach={props.onAttachEvidence}
            />
          )}
        </Show>

        <section class="ticket-drawer-section">
          <h4 class="ticket-drawer-heading">{t("tickets.drawer.activity")}</h4>
          <Show when={props.onComment}>{(comment) => <TicketCommentBox onComment={comment()} />}</Show>
          <Show
            when={newestFirst().length > 0}
            fallback={<p class="tickets-muted">{t("tickets.drawer.activityEmpty")}</p>}
          >
            <ol class="ticket-drawer-events">
              <For each={newestFirst()} keyed={(event) => event.id}>
                {(event) => (
                  <li class="ticket-drawer-event">
                    <span class="ticket-drawer-event-dot" aria-hidden="true" />
                    <span class="ticket-drawer-event-text">
                      <span>{eventText(event())}</span>
                      <span class="ticket-drawer-event-meta" title={time(event().createdAt)}>
                        {t("tickets.drawer.eventMeta", {
                          actor: actorName(event()),
                          time: agoShort(event().createdAt),
                        })}
                      </span>
                    </span>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </section>
      </div>

      <Show when={props.ticket.taskId}>
        <form
          class="ticket-drawer-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div class="ticket-drawer-composer-box">
            <Textarea
              ref={steerBox}
              class="ticket-drawer-composer-input"
              value={draft()}
              onValueChange={setDraft}
              rows={2}
              aria-label={canRequestChanges() ? t("tickets.drawer.requestChanges") : t("tickets.drawer.steer")}
              placeholder={
                canRequestChanges() ? t("tickets.drawer.reviewPlaceholder") : t("tickets.drawer.steerPlaceholder")
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div class="ticket-drawer-composer-row">
              <span class="ticket-drawer-composer-hint">{t("tickets.drawer.enterToSend")}</span>
              <Button type="submit" size="sm" loading={sending()} disabled={!draft().trim()}>
                <Send aria-hidden="true" />
                {canRequestChanges() ? t("tickets.drawer.requestChanges") : t("tickets.drawer.send")}
              </Button>
            </div>
          </div>
        </form>
      </Show>
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
