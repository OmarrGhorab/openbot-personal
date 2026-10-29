import { isBoundedString, isFiniteNumber, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

/**
 * The Tickets board. Every piece of agent work is a board ticket in one of five columns. An agent moves
 * its own tickets; the person can drag a ticket to override. When a ticket system is connected and the
 * board names a sync target, a ticket links one external issue. Otherwise the ticket lives on this
 * computer only.
 */
export const BOARD_TICKET_STATUSES = ["backlog", "queued", "running", "needs_review", "done"] as const;
export type BoardTicketStatus = (typeof BOARD_TICKET_STATUSES)[number];

export const BOARD_TICKET_PROVIDERS = ["github", "jira", "linear"] as const;
export type BoardTicketProvider = (typeof BOARD_TICKET_PROVIDERS)[number];

export const BOARD_TICKET_EVENT_KINDS = ["created", "moved", "assigned", "comment", "progress"] as const;
export type BoardTicketEventKind = (typeof BOARD_TICKET_EVENT_KINDS)[number];

export const BOARD_TICKET_ACTORS = ["user", "agent", "sync"] as const;
export type BoardTicketActor = (typeof BOARD_TICKET_ACTORS)[number];

export const BOARD_TICKET_TITLE_LIMIT = 200;
export const BOARD_TICKET_BODY_LIMIT = 20_000;
export const BOARD_TICKET_PROGRESS_LIMIT = 500;
export const BOARD_TICKET_ERROR_LIMIT = 2_000;
export const BOARD_TICKET_COMMENT_LIMIT = 4_000;
export const BOARD_TICKET_EXTERNAL_KEY_LIMIT = 300;
export const BOARD_TICKET_URL_LIMIT = 2_000;
/** The most tickets that one board list returns. */
export const BOARD_TICKET_LIST_LIMIT = 2_000;
/** The most events that one ticket's activity returns, newest kept. */
export const BOARD_TICKET_EVENT_LIMIT = 500;

/** The linked issue of a ticket system. */
export interface BoardTicketExternal {
  provider: BoardTicketProvider;
  /** The stable ID of the issue, such as `owner/repo#12` for GitHub or `PH-88` for Linear. */
  key: string;
  url: string;
}

export interface BoardTicket {
  id: string;
  title: string;
  body: string;
  status: BoardTicketStatus;
  /** The assigned agent. Null: the ticket is unassigned. */
  agentId: string | null;
  /** The order in the column. A lower value shows higher. */
  order: number;
  /** The work thread (agent task) that does the ticket's work. */
  taskId: string | null;
  /** The conversation thread of that work thread. */
  threadId: string | null;
  /** The Raven Stack team job and role that the ticket belongs to. */
  teamJobId: string | null;
  teamRoleId: string | null;
  external: BoardTicketExternal | null;
  /** The live progress line, such as "Checked 41 of 112 links". */
  progress: string | null;
  /** The last failure line, such as "The last turn failed". */
  error: string | null;
  /** When the ticket last entered each column. The stepper shows these. */
  statusTimes: Partial<Record<BoardTicketStatus, string>>;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** One entry of a ticket's activity. */
export interface BoardTicketEvent {
  id: string;
  ticketId: string;
  kind: BoardTicketEventKind;
  actor: BoardTicketActor;
  fromStatus: BoardTicketStatus | null;
  toStatus: BoardTicketStatus | null;
  text: string | null;
  createdAt: string;
}

/** The change event: the IDs of the tickets that changed or were deleted. The view reads the list again. */
export interface BoardTicketsChanged {
  ticketIds: string[];
}

export interface CreateBoardTicketInput {
  title: string;
  body?: string;
  /** The default is `backlog`. */
  status?: BoardTicketStatus;
  agentId?: string | null;
}

/** Changes the fields that are present. `null` clears a nullable field. */
export interface UpdateBoardTicketInput {
  ticketId: string;
  title?: string;
  body?: string;
  agentId?: string | null;
  progress?: string | null;
  error?: string | null;
}

/** Moves a ticket to a column. With `beforeTicketId`, it goes above that ticket; without, to the end. */
export interface MoveBoardTicketInput {
  ticketId: string;
  status: BoardTicketStatus;
  beforeTicketId?: string | null;
}

export interface CommentBoardTicketInput {
  ticketId: string;
  text: string;
}

export function isBoardTicketStatus(value: unknown): value is BoardTicketStatus {
  return isOneOf(BOARD_TICKET_STATUSES, value);
}

function isBoardTicketExternal(value: unknown): value is BoardTicketExternal {
  return (
    isDynamicRecord(value) &&
    isOneOf(BOARD_TICKET_PROVIDERS, value.provider) &&
    isBoundedString(value.key, BOARD_TICKET_EXTERNAL_KEY_LIMIT) &&
    value.key.length > 0 &&
    isBoundedString(value.url, BOARD_TICKET_URL_LIMIT)
  );
}

function isStatusTimes(value: unknown): value is Partial<Record<BoardTicketStatus, string>> {
  return (
    isDynamicRecord(value) &&
    Object.entries(value).every(([status, time]) => isBoardTicketStatus(status) && isBoundedString(time, 160))
  );
}

function isNullableIdentifier(value: unknown): value is string | null {
  return value === null || isIdentifier(value);
}

export function isBoardTicket(value: unknown): value is BoardTicket {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.title, BOARD_TICKET_TITLE_LIMIT) &&
    isBoundedString(value.body, BOARD_TICKET_BODY_LIMIT) &&
    isBoardTicketStatus(value.status) &&
    isNullableIdentifier(value.agentId) &&
    isFiniteNumber(value.order) &&
    isNullableIdentifier(value.taskId) &&
    isNullableIdentifier(value.threadId) &&
    isNullableIdentifier(value.teamJobId) &&
    isNullableIdentifier(value.teamRoleId) &&
    (value.external === null || isBoardTicketExternal(value.external)) &&
    isNullableBoundedString(value.progress, BOARD_TICKET_PROGRESS_LIMIT) &&
    isNullableBoundedString(value.error, BOARD_TICKET_ERROR_LIMIT) &&
    isStatusTimes(value.statusTimes) &&
    isBoundedString(value.statusChangedAt, 160) &&
    isBoundedString(value.createdAt, 160) &&
    isBoundedString(value.updatedAt, 160)
  );
}

export function isBoardTicketList(value: unknown): value is BoardTicket[] {
  return Array.isArray(value) && value.length <= BOARD_TICKET_LIST_LIMIT && value.every(isBoardTicket);
}

export function isBoardTicketEvent(value: unknown): value is BoardTicketEvent {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.ticketId) &&
    isOneOf(BOARD_TICKET_EVENT_KINDS, value.kind) &&
    isOneOf(BOARD_TICKET_ACTORS, value.actor) &&
    (value.fromStatus === null || isBoardTicketStatus(value.fromStatus)) &&
    (value.toStatus === null || isBoardTicketStatus(value.toStatus)) &&
    isNullableBoundedString(value.text, BOARD_TICKET_COMMENT_LIMIT) &&
    isBoundedString(value.createdAt, 160)
  );
}

export function isBoardTicketEventList(value: unknown): value is BoardTicketEvent[] {
  return Array.isArray(value) && value.length <= BOARD_TICKET_EVENT_LIMIT && value.every(isBoardTicketEvent);
}

export function isBoardTicketsChanged(value: unknown): value is BoardTicketsChanged {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.ticketIds) &&
    value.ticketIds.length <= BOARD_TICKET_LIST_LIMIT &&
    value.ticketIds.every(isIdentifier)
  );
}
