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
import type { AppTextKey } from "@openbot/i18n";

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
