import {
  BOARD_TICKET_BODY_LIMIT,
  BOARD_TICKET_COMMENT_LIMIT,
  BOARD_TICKET_ERROR_LIMIT,
  BOARD_TICKET_PROGRESS_LIMIT,
  BOARD_TICKET_TITLE_LIMIT,
  type BoardTicket,
  type BoardTicketActor,
  type BoardTicketEvent,
  type BoardTicketStatus,
  type CommentBoardTicketInput,
  type CreateBoardTicketInput,
  type MoveBoardTicketInput,
  type UpdateBoardTicketInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { BoardTicketPatch, BoardTicketStore, NewBoardTicket } from "./board-ticket-store";

export interface BoardTicketServiceOptions {
  store: BoardTicketStore;
  /** Called after each change with the IDs of the changed or deleted tickets, so the view reads the list. */
  changed: (ticketIds: string[]) => void;
}

/** The links that a ticket created by the work-thread module, a team job or the sync starts with. */
export type BoardTicketLinks = Pick<NewBoardTicket, "taskId" | "threadId" | "teamJobId" | "teamRoleId" | "external">;

/**
 * The Tickets board: the domain rules over `BoardTicketStore`. It validates each change, writes it,
 * records the activity, and sends one change event. It never imports the database facade.
 */
export class BoardTicketService {
  readonly #store: BoardTicketStore;
  readonly #changed: (ticketIds: string[]) => void;

  constructor(options: BoardTicketServiceOptions) {
    this.#store = options.store;
    this.#changed = options.changed;
  }

  list(): BoardTicket[] {
    return this.#store.list();
  }

  get(ticketId: string): BoardTicket | null {
    return this.#store.get(ticketId);
  }

  events(ticketId: string): BoardTicketEvent[] {
    this.#require(ticketId);
    return this.#store.events(ticketId);
  }

  create(input: CreateBoardTicketInput, actor: BoardTicketActor = "user", links: BoardTicketLinks = {}): BoardTicket {
    const ticket = this.#store.create(
      {
        ...links,
        title: cleanTitle(input.title),
        body: input.body?.slice(0, BOARD_TICKET_BODY_LIMIT) ?? "",
        status: input.status ?? "backlog",
        agentId: input.agentId ?? null,
      },
      actor,
    );
    if (ticket.agentId) this.#store.addEvent(ticket.id, "assigned", actor, { text: ticket.agentId });
    this.#changed([ticket.id]);
    return ticket;
  }

  update(input: UpdateBoardTicketInput, actor: BoardTicketActor = "user"): BoardTicket {
    const patch: BoardTicketPatch = {};
    if (input.title !== undefined) patch.title = cleanTitle(input.title);
    if (input.body !== undefined) patch.body = input.body.slice(0, BOARD_TICKET_BODY_LIMIT);
    if (input.agentId !== undefined) patch.agentId = input.agentId;
    if (input.progress !== undefined) patch.progress = nullableLine(input.progress, BOARD_TICKET_PROGRESS_LIMIT);
    if (input.error !== undefined) patch.error = nullableLine(input.error, BOARD_TICKET_ERROR_LIMIT);
    return this.patch(input.ticketId, patch, actor);
  }

  /** Writes a validated patch. The work-thread module and the sync use it for their links. */
  patch(ticketId: string, patch: BoardTicketPatch, actor: BoardTicketActor): BoardTicket {
    const current = this.#require(ticketId);
    this.#store.update(ticketId, patch);
    if (patch.agentId !== undefined && patch.agentId !== current.agentId) {
      this.#store.addEvent(ticketId, "assigned", actor, { text: patch.agentId });
    }
    if (patch.progress && patch.progress !== current.progress) {
      this.#store.addEvent(ticketId, "progress", actor, { text: patch.progress });
    }
    this.#changed([ticketId]);
    return this.#require(ticketId);
  }

  move(input: MoveBoardTicketInput, actor: BoardTicketActor = "user", note: string | null = null): BoardTicket {
    this.#require(input.ticketId);
    const moved = this.#store.move(input.ticketId, input.status, input.beforeTicketId ?? null, actor, note);
    if (!moved) throw new Error(sourceText("error.agent.boardTickets.notFound"));
    this.#changed([moved.id]);
    return moved;
  }

  /** Moves the ticket only when its column differs. Answers whether it moved. */
  moveIfNeeded(
    ticketId: string,
    status: BoardTicketStatus,
    actor: BoardTicketActor,
    note: string | null = null,
  ): boolean {
    const current = this.#store.get(ticketId);
    if (!current || current.status === status) return false;
    this.move({ ticketId, status }, actor, note);
    return true;
  }

  comment(input: CommentBoardTicketInput, actor: BoardTicketActor = "user"): BoardTicketEvent {
    this.#require(input.ticketId);
    const text = input.text.trim();
    if (!text) throw new Error(sourceText("error.agent.boardTickets.emptyComment"));
    const event = this.#store.addEvent(input.ticketId, "comment", actor, {
      text: text.slice(0, BOARD_TICKET_COMMENT_LIMIT),
    });
    this.#changed([input.ticketId]);
    return event;
  }

  delete(ticketId: string): void {
    if (!this.#store.delete(ticketId)) throw new Error(sourceText("error.agent.boardTickets.notFound"));
    this.#changed([ticketId]);
  }

  #require(ticketId: string): BoardTicket {
    const ticket = this.#store.get(ticketId);
    if (!ticket) throw new Error(sourceText("error.agent.boardTickets.notFound"));
    return ticket;
  }
}

function cleanTitle(title: string): string {
  const clean = title.replace(/\s+/gu, " ").trim();
  if (!clean) throw new Error(sourceText("error.agent.boardTickets.emptyTitle"));
  return clean.slice(0, BOARD_TICKET_TITLE_LIMIT);
}

function nullableLine(text: string | null, limit: number): string | null {
  if (text === null) return null;
  const line = text.replace(/\s+/gu, " ").trim();
  return line ? line.slice(0, limit) : null;
}
