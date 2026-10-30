import {
  type AgentTask,
  type AgentTasksSnapshot,
  type AttachmentSummary,
  BOARD_TICKET_STATUSES,
  type BoardTicket,
  type BoardTicketStatus,
  type ConversationMessage,
  type ConversationPlan,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";

/** The columns of the board, from left to right. */
export const TICKET_COLUMNS: readonly BoardTicketStatus[] = BOARD_TICKET_STATUSES;

/** The name of each column. */
export const TICKET_STATUS_LABEL = {
  backlog: "tickets.status.backlog",
  queued: "tickets.status.queued",
  running: "tickets.status.running",
  needs_review: "tickets.status.needsReview",
  done: "tickets.status.done",
} as const satisfies Record<BoardTicketStatus, AppTextKey>;

/** The board shows the columns; the lanes show one row for each agent and one for the unassigned tickets. */
export type TicketsView = "board" | "agents";

export function isTicketsView(value: string): value is TicketsView {
  return value === "board" || value === "agents";
}

/** What a start sends: an existing ticket, or the title and the body of a new one. */
export interface TicketStart {
  agentId: string;
  ticketId?: string;
  title?: string;
  body?: string;
}

/** The tickets of one column, in board order. */
export function columnTickets(tickets: readonly BoardTicket[], status: BoardTicketStatus): BoardTicket[] {
  return tickets.filter((ticket) => ticket.status === status).sort((left, right) => left.order - right.order);
}

/** The tickets of one agent, or the unassigned ones for `null`, by column and then in board order. */
export function laneTickets(tickets: readonly BoardTicket[], agentId: string | null): BoardTicket[] {
  return tickets
    .filter((ticket) => ticket.agentId === agentId)
    .sort(
      (left, right) =>
        TICKET_COLUMNS.indexOf(left.status) - TICKET_COLUMNS.indexOf(right.status) || left.order - right.order,
    );
}

const THREAD_RANK: Record<AgentTask["state"], number> = { running: 0, queued: 1, idle: 2, closed: 3 };

const THREAD_STATE_LABEL = {
  running: "tickets.thread.running",
  queued: "tickets.thread.queued",
  idle: "tickets.thread.idle",
  closed: "tickets.thread.closed",
} as const satisfies Record<AgentTask["state"], AppTextKey>;

/** The work threads of an agent that are not closed: the running ones first, then the queued, then the idle. */
export function openThreads(snapshot: AgentTasksSnapshot | undefined): AgentTask[] {
  return (snapshot?.tasks ?? [])
    .filter((task) => task.state !== "closed")
    .sort((left, right) => THREAD_RANK[left.state] - THREAD_RANK[right.state]);
}

/** How many work threads of the agent run a turn now. */
export function runningThreads(snapshot: AgentTasksSnapshot | undefined): number {
  return snapshot?.tasks.filter((task) => task.state === "running").length ?? 0;
}

/** The work thread of a ticket, once the thread list of its agent loaded. */
export function ticketThread(ticket: BoardTicket, snapshot: AgentTasksSnapshot | undefined): AgentTask | undefined {
  const taskId = ticket.taskId;
  return taskId ? snapshot?.tasks.find((task) => task.id === taskId) : undefined;
}

/** The live line of a ticket: its own progress, or what its running thread does now. */
export function ticketProgress(ticket: BoardTicket, thread: AgentTask | undefined): string | null {
  if (ticket.progress) return ticket.progress;
  return thread?.state === "running" ? thread.progress : null;
}

/**
 * The failure of a ticket: its own error line, or the error of the failed last turn of its thread. An
 * empty string means that the turn failed and the provider reported nothing.
 */
export function ticketError(ticket: BoardTicket, thread: AgentTask | undefined): string | null {
  if (ticket.error) return ticket.error;
  return thread?.outcome === "failed" ? (thread.error ?? "") : null;
}

/** The text key of the state of a thread. A paused thread says so, whatever its queue holds. */
export function threadStateLabel(thread: AgentTask): AppTextKey {
  if (thread.pausedAt) return "tickets.thread.paused";
  return THREAD_STATE_LABEL[thread.state];
}

/** The newest plan of the turns of a thread, as the plan tool of the agent last wrote it. */
export function latestPlan(messages: readonly ConversationMessage[]): ConversationPlan | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const plan = messages[index]?.plan;
    if (plan && plan.steps.length > 0) return plan;
  }
  return null;
}

/** The files of a thread: every attachment of its messages, once each. */
export function threadFiles(messages: readonly ConversationMessage[]): AttachmentSummary[] {
  const files = new Map<string, AttachmentSummary>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) files.set(attachment.id, attachment);
  }
  return [...files.values()];
}

interface TurnTokens {
  id: string;
  /** The place of the turn among the counted turns, from 1. */
  turn: number;
  tokens: number;
}

/** The tokens that the provider reported for each finished turn. A turn with no count is left out. */
export function turnTokens(messages: readonly ConversationMessage[]): TurnTokens[] {
  const turns: TurnTokens[] = [];
  for (const message of messages) {
    const tokens = message.trace?.tokens;
    if (tokens !== undefined) turns.push({ id: message.id, turn: turns.length + 1, tokens });
  }
  return turns;
}

/** How many turns of the thread finished: each finished turn carries one trace. */
export function finishedTurns(messages: readonly ConversationMessage[]): number {
  return messages.filter((message) => message.trace !== undefined).length;
}

/** The four work steps that a card shows for a ticket in Running, Needs review or Done. */
export const TICKET_STEPS = ["plan", "build", "review", "merge"] as const;
type TicketStep = (typeof TICKET_STEPS)[number];

export const TICKET_STEP_LABEL = {
  plan: "tickets.step.plan",
  build: "tickets.step.build",
  review: "tickets.step.review",
  merge: "tickets.step.merge",
} as const satisfies Record<TicketStep, AppTextKey>;

/**
 * How the current step goes: `active` while an agent works on it, `waiting` while it waits for the
 * person's review, `blocked` while it needs a decision or its last turn failed, `done` when every step is.
 */
export type TicketStepState = "active" | "waiting" | "blocked" | "done";

/** The current step of a ticket, as an index into `TICKET_STEPS`, and how it goes. */
export interface TicketStepsView {
  index: number;
  state: TicketStepState;
}

/** A Raven Stack role whose work is a review, such as `reviewer` or `qa`. */
const REVIEW_ROLE = /review|qa|test|verif/iu;

function isReviewRole(roleId: string | null): boolean {
  return roleId !== null && REVIEW_ROLE.test(roleId);
}

/**
 * Whether a review role of the ticket's team job works now. A role ticket answers for its own role. The
 * role states come from the role tickets, which move with the roles of the job.
 */
function inReview(ticket: BoardTicket, tickets: readonly BoardTicket[]): boolean {
  if (ticket.teamRoleId !== null) return isReviewRole(ticket.teamRoleId);
  const jobId = ticket.teamJobId;
  if (jobId === null) return false;
  return tickets.some(
    (candidate) =>
      candidate.teamJobId === jobId &&
      isReviewRole(candidate.teamRoleId) &&
      (candidate.status === "running" || candidate.status === "needs_review"),
  );
}

/**
 * Whether the ticket needs the person for something other than a review: its last turn failed, its
 * thread asks a question, or its team job waits for a decision. A plain ticket in Needs review after a
 * completed turn only waits for the review.
 */
export function ticketBlocked(ticket: BoardTicket, thread: AgentTask | undefined): boolean {
  if (ticketError(ticket, thread) !== null) return true;
  if (ticket.status !== "needs_review") return false;
  return Boolean(thread?.question) || ticket.teamJobId !== null;
}

/**
 * The steps of a ticket from its column and the role tickets of its team job, with no stored data of
 * their own: Build while it runs (Review while a review role runs), Review in Needs review, and every
 * step in Done. Null for Backlog and Queued, which show no steps.
 */
export function ticketSteps(
  ticket: BoardTicket,
  tickets: readonly BoardTicket[],
  thread: AgentTask | undefined,
): TicketStepsView | null {
  switch (ticket.status) {
    case "done":
      return { index: TICKET_STEPS.length - 1, state: "done" };
    case "running":
      return { index: inReview(ticket, tickets) ? 2 : 1, state: ticketBlocked(ticket, thread) ? "blocked" : "active" };
    case "needs_review":
      return { index: 2, state: ticketBlocked(ticket, thread) ? "blocked" : "waiting" };
    default:
      return null;
  }
}

/** The state that the left edge of a card shows: running, waiting for review, blocked or done. */
export type TicketEdge = "running" | "waiting" | "blocked" | "done";

export function ticketEdge(ticket: BoardTicket, thread: AgentTask | undefined): TicketEdge | null {
  if (ticket.status === "done") return "done";
  if (ticketBlocked(ticket, thread)) return "blocked";
  if (ticket.status === "running") return "running";
  if (ticket.status === "needs_review") return "waiting";
  return null;
}

const MINUTE_MS = 60_000;

/** How long ago a time was, such as "12m ago", "3h ago", "Yesterday" or "4d ago". */
export function ticketAgo(iso: string, now: Date, t: AppTranslate): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / MINUTE_MS);
  if (!Number.isFinite(minutes) || minutes < 1) return t("tickets.time.justNow");
  if (minutes < 60) return t("tickets.time.minutesAgo", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("tickets.time.hoursAgo", { hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? t("tickets.time.yesterday") : t("tickets.time.daysAgo", { days });
}

/** How long something has run, such as "14m" or "3h". Less than a minute counts as 1m. */
export function ticketElapsed(iso: string, now: Date, t: AppTranslate): string {
  const counted = Math.floor((now.getTime() - Date.parse(iso)) / MINUTE_MS);
  const minutes = Number.isFinite(counted) ? Math.max(1, counted) : 1;
  return minutes < 60
    ? t("tickets.time.minutes", { minutes })
    : t("tickets.time.hours", { hours: Math.floor(minutes / 60) });
}

/** A short key for the card: `#12` for a GitHub issue, the key itself for Jira and Linear. */
export function shortTicketKey(key: string): string {
  const issue = /#(\d+)$/u.exec(key);
  return issue ? `#${issue[1]}` : key;
}
