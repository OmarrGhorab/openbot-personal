import {
  type AgentTask,
  BOARD_TICKET_BODY_LIMIT,
  BOARD_TICKET_COMMENT_LIMIT,
  BOARD_TICKET_ERROR_LIMIT,
  BOARD_TICKET_PROGRESS_LIMIT,
  BOARD_TICKET_TITLE_LIMIT,
  type BoardTicket,
  type BoardTicketActor,
  type BoardTicketEvent,
  type BoardTicketStatus,
  type BoardTicketTypeSource,
  type BoardTicketWorktree,
  type CommentBoardTicketInput,
  type CreateBoardTicketInput,
  detectBoardTicketType,
  type MoveBoardTicketInput,
  type StartBoardTicketInput,
  type UpdateBoardTicketInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { BoardTicketPatch, BoardTicketStore, NewBoardTicket } from "./board-ticket-store";

export interface BoardTicketServiceOptions {
  store: BoardTicketStore;
  /** Called after each change with the IDs of the changed or deleted tickets, so the view reads the list. */
  changed: (ticketIds: string[]) => void;
  /** Starts a work thread of the agent with this first message. Without it, `start` refuses. */
  startWorkThread?: StartWorkThread;
  /** The worktree path and branch of a work thread, shown on its ticket. */
  worktreeOf?: (taskId: string) => BoardTicketWorktree | null;
}

/** Starts one work thread (agent task) of an agent, as the ticket intake does. */
export type StartWorkThread = (
  agentId: string,
  text: string,
  ticket?: { title: string },
) => Promise<Pick<AgentTask, "id" | "threadId" | "state">>;

/** The agent's own update of the ticket of its work thread. The `update_ticket` tool checks it first. */
export interface BoardTicketAgentUpdate {
  status?: BoardTicketStatus | undefined;
  progress?: string | undefined;
  comment?: string | undefined;
}

/** The links that a ticket created by the work-thread module, a team job or the sync starts with. */
export type BoardTicketLinks = Pick<NewBoardTicket, "taskId" | "threadId" | "teamJobId" | "teamRoleId" | "external">;

/** A move into another column or a comment, for the sync. `actor` says who made it. */
export type BoardTicketActivity =
  | { kind: "moved"; ticket: BoardTicket; from: BoardTicketStatus; to: BoardTicketStatus; actor: BoardTicketActor }
  | { kind: "comment"; ticket: BoardTicket; text: string; actor: BoardTicketActor };

/**
 * The Tickets board: the domain rules over `BoardTicketStore`. It validates each change, writes it,
 * records the activity, and sends one change event. It never imports the database facade.
 */
export class BoardTicketService {
  readonly #store: BoardTicketStore;
  readonly #changed: (ticketIds: string[]) => void;
  readonly #startWorkThread: StartWorkThread | undefined;
  readonly #worktreeOf: ((taskId: string) => BoardTicketWorktree | null) | undefined;
  readonly #activity = new Set<(activity: BoardTicketActivity) => void>();

  constructor(options: BoardTicketServiceOptions) {
    this.#store = options.store;
    this.#changed = options.changed;
    this.#startWorkThread = options.startWorkThread;
    this.#worktreeOf = options.worktreeOf;
  }

  list(): BoardTicket[] {
    return this.#store.list().map((ticket) => this.#withWorktree(ticket));
  }

  get(ticketId: string): BoardTicket | null {
    const ticket = this.#store.get(ticketId);
    return ticket ? this.#withWorktree(ticket) : null;
  }

  /** The ticket with the worktree of its work thread, when it has one. */
  #withWorktree(ticket: BoardTicket): BoardTicket {
    if (!ticket.taskId || !this.#worktreeOf) return ticket;
    const worktree = this.#worktreeOf(ticket.taskId);
    return worktree ? { ...ticket, worktree } : ticket;
  }

  /** The ticket that a work thread does, or null. */
  forTask(taskId: string): BoardTicket | null {
    return this.#store.forTask(taskId);
  }

  /** The tickets of a Raven Stack team job: its own ticket and one for each role. */
  forTeamJob(jobId: string): BoardTicket[] {
    return this.#store.forTeamJob(jobId);
  }

  /**
   * The agent's own update of the ticket that its work thread does: a progress line, a comment and a
   * move, in that order. Null when the work thread does no ticket. The tool lets no agent move a ticket
   * to Done: that is the person's approval.
   */
  updateForTask(taskId: string, update: BoardTicketAgentUpdate): BoardTicket | null {
    const ticket = this.#store.forTask(taskId);
    if (!ticket) return null;
    if (update.progress !== undefined) {
      this.patch(ticket.id, { progress: nullableLine(update.progress, BOARD_TICKET_PROGRESS_LIMIT) }, "agent");
    }
    if (update.comment !== undefined) this.comment({ ticketId: ticket.id, text: update.comment }, "agent");
    if (update.status !== undefined) this.moveIfNeeded(ticket.id, update.status, "agent");
    return this.#require(ticket.id);
  }

  /** Tells the listener each move into another column and each comment. Answers the unsubscribe. */
  onActivity(listener: (activity: BoardTicketActivity) => void): () => void {
    this.#activity.add(listener);
    return () => {
      this.#activity.delete(listener);
    };
  }

  events(ticketId: string): BoardTicketEvent[] {
    this.#require(ticketId);
    return this.#store.events(ticketId);
  }

  /**
   * Adds a ticket. A type in the input is the creator's choice; without one, the board detects the type
   * from the labels of the linked issue, then from the title and the text.
   */
  create(
    input: CreateBoardTicketInput,
    actor: BoardTicketActor = "user",
    links: BoardTicketLinks = {},
    labels: readonly string[] = [],
  ): BoardTicket {
    const title = cleanTitle(input.title);
    const body = input.body?.slice(0, BOARD_TICKET_BODY_LIMIT) ?? "";
    const chosen = input.type !== undefined;
    const type = chosen ? input.type : detectBoardTicketType({ labels, title, body });
    const ticket = this.#store.create(
      {
        ...links,
        title,
        body,
        status: input.status ?? "backlog",
        agentId: input.agentId ?? null,
        type: type ?? null,
        typeSource: chosen ? choiceSource(actor) : type ? "detected" : null,
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
    if (input.type !== undefined) {
      patch.type = input.type;
      patch.typeSource = choiceSource(actor);
    }
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
    if (patch.type !== undefined && patch.type !== current.type) {
      this.#store.addEvent(ticketId, "type_changed", actor, { text: patch.type });
    }
    if (patch.progress && patch.progress !== current.progress) {
      this.#store.addEvent(ticketId, "progress", actor, { text: patch.progress });
    }
    this.#changed([ticketId]);
    return this.#require(ticketId);
  }

  /**
   * Detects the type of a ticket again after its issue changed, such as a new label at a sync. A type that
   * a person or an agent chose stays: detection changes only a type that detection set or that is not set,
   * and it never clears one.
   */
  redetectType(
    ticketId: string,
    signs: { labels?: readonly string[]; title: string; body?: string },
    actor: BoardTicketActor,
  ): BoardTicket {
    const current = this.#require(ticketId);
    if (current.typeSource === "user" || current.typeSource === "agent") return current;
    const type = detectBoardTicketType(signs);
    if (type === null || type === current.type) return current;
    return this.patch(ticketId, { type, typeSource: "detected" }, actor);
  }

  move(input: MoveBoardTicketInput, actor: BoardTicketActor = "user", note: string | null = null): BoardTicket {
    const current = this.#require(input.ticketId);
    const moved = this.#store.move(input.ticketId, input.status, input.beforeTicketId ?? null, actor, note);
    if (!moved) throw new Error(sourceText("error.agent.boardTickets.notFound"));
    this.#changed([moved.id]);
    if (moved.status !== current.status) {
      this.#tell({ kind: "moved", ticket: moved, from: current.status, to: moved.status, actor });
    }
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
    this.#tell({ kind: "comment", ticket: this.#require(input.ticketId), text: event.text ?? text, actor });
    return event;
  }

  /**
   * Starts the work of a ticket: one work thread of the agent, with the title and the body as its first
   * message, linked to the ticket. A new ticket is written only after its work thread starts, so a
   * failed start leaves no ticket behind. The ticket goes to Running, or to Queued while the thread waits.
   */
  async start(input: StartBoardTicketInput, actor: BoardTicketActor = "user"): Promise<BoardTicket> {
    const startWorkThread = this.#startWorkThread;
    if (!startWorkThread) throw new Error(sourceText("error.agent.boardTickets.startUnavailable"));
    const existing = input.ticketId === undefined ? null : this.#require(input.ticketId);
    if (existing?.taskId) throw new Error(sourceText("error.agent.boardTickets.alreadyStarted"));
    const title = cleanTitle(existing?.title ?? input.title ?? "");
    const body = (existing ? existing.body : (input.body ?? "")).slice(0, BOARD_TICKET_BODY_LIMIT);
    const task = await startWorkThread(input.agentId, workThreadText(title, body), { title });
    const status: BoardTicketStatus = task.state === "running" ? "running" : "queued";
    const links = { taskId: task.id, threadId: task.threadId };
    if (!existing) return this.create({ title, body, status, agentId: input.agentId }, actor, links);
    this.patch(existing.id, { ...links, agentId: input.agentId }, actor);
    this.moveIfNeeded(existing.id, status, actor);
    return this.get(existing.id) ?? this.#require(existing.id);
  }

  delete(ticketId: string): void {
    if (!this.#store.delete(ticketId)) throw new Error(sourceText("error.agent.boardTickets.notFound"));
    this.#changed([ticketId]);
  }

  #tell(activity: BoardTicketActivity): void {
    for (const listener of this.#activity) listener(activity);
  }

  #require(ticketId: string): BoardTicket {
    const ticket = this.#store.get(ticketId);
    if (!ticket) throw new Error(sourceText("error.agent.boardTickets.notFound"));
    return ticket;
  }
}

/** Who chose a type: an agent's choice is the agent's; any other choice is the person's. */
function choiceSource(actor: BoardTicketActor): BoardTicketTypeSource {
  return actor === "agent" ? "agent" : "user";
}

function cleanTitle(title: string): string {
  const clean = title.replace(/\s+/gu, " ").trim();
  if (!clean) throw new Error(sourceText("error.agent.boardTickets.emptyTitle"));
  return clean.slice(0, BOARD_TICKET_TITLE_LIMIT);
}

/** The first message of a ticket's work thread: the title, then the body when it has one. */
function workThreadText(title: string, body: string): string {
  const details = body.trim();
  return details ? `${title}\n\n${details}` : title;
}

function nullableLine(text: string | null, limit: number): string | null {
  if (text === null) return null;
  const line = text.replace(/\s+/gu, " ").trim();
  return line ? line.slice(0, limit) : null;
}
