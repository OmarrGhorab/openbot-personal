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
  type BoardTicketEvidence,
  type BoardTicketPhase,
  type BoardTicketStatus,
  type BoardTicketType,
  type BoardTicketTypeSource,
  type BoardTicketVerdict,
  type BoardTicketWorktree,
  boardTicketVerdicts,
  type CommentBoardTicketInput,
  type CreateBoardTicketInput,
  detectBoardTicketType,
  type MoveBoardTicketInput,
  type StartBoardTicketInput,
  type UpdateBoardTicketInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { BoardTicketEvidenceInput, BoardTicketEvidenceStore } from "./board-ticket-evidence";
import {
  pickTicketReviewer,
  type ReviewCandidate,
  TICKET_REVIEW_FAIL_LIMIT,
  ticketReviewBrief,
  verdictEventText,
} from "./board-ticket-review";
import type { BoardTicketPatch, BoardTicketStore, NewBoardTicket } from "./board-ticket-store";

export interface BoardTicketServiceOptions {
  store: BoardTicketStore;
  /** Called after each change with the IDs of the changed or deleted tickets, so the view reads the list. */
  changed: (ticketIds: string[]) => void;
  /** Starts a work thread of the agent with this first message. Without it, `start` refuses. */
  startWorkThread?: StartWorkThread;
  /** The evidence of the tickets (#236). Without it, evidence requests refuse. */
  evidence?: BoardTicketEvidenceStore;
  /**
   * Sends a message to a work thread (taskId) or to the agent's chat (null), as the person. It throws
   * when the thread cannot take it, such as a closed or missing task. Without it, Request changes refuses.
   */
  sendToWorkThread?: (agentId: string, taskId: string | null, text: string) => Promise<void>;
  /** The agent that owns a work thread, which can differ from the ticket's agent after a reassign. */
  taskOwner?: (taskId: string) => string | null;
  /** The worktree path and branch of a work thread, shown on its ticket. */
  worktreeOf?: (taskId: string) => BoardTicketWorktree | null;
  /** The agents that can review a ticket, with their models (ticket 239). Without it, a review refuses. */
  reviewers?: () => ReviewCandidate[];
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
  /** Ticket 237: the agent's type, never over a person's choice; its failure line; its work phase. */
  type?: BoardTicketType | undefined;
  error?: string | undefined;
  phase?: BoardTicketPhase | undefined;
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
  readonly #evidence: BoardTicketEvidenceStore | undefined;
  readonly #worktreeOf: ((taskId: string) => BoardTicketWorktree | null) | undefined;
  readonly #sendToWorkThread: BoardTicketServiceOptions["sendToWorkThread"];
  readonly #taskOwner: BoardTicketServiceOptions["taskOwner"];
  readonly #reviewers: BoardTicketServiceOptions["reviewers"];
  /** The reviewer work thread of each requested review, by its task ID (ticket 239). */
  readonly #reviews = new Map<string, { ticketId: string; reviewerId: string }>();
  /** The tickets whose Start is in flight, so a second click does not start a second run. */
  readonly #starting = new Set<string>();
  readonly #activity = new Set<(activity: BoardTicketActivity) => void>();

  constructor(options: BoardTicketServiceOptions) {
    this.#store = options.store;
    this.#changed = options.changed;
    this.#startWorkThread = options.startWorkThread;
    this.#worktreeOf = options.worktreeOf;
    this.#sendToWorkThread = options.sendToWorkThread;
    this.#taskOwner = options.taskOwner;
    this.#evidence = options.evidence;
    this.#reviewers = options.reviewers;
  }

  /**
   * Ticket 239: the author thread asks for an independent review of its pull request. The reviewer is
   * another agent on another model; its work thread gets the pull request, the issue and the evidence.
   */
  async requestReview(
    ticketId: string,
    input: { pullRequest: number; notes?: string | undefined },
  ): Promise<{ reviewerId: string; taskId: string }> {
    const ticket = this.#require(ticketId);
    const startWorkThread = this.#startWorkThread;
    const candidates = this.#reviewers?.() ?? [];
    if (!startWorkThread) throw new Error(sourceText("error.agent.boardTickets.startUnavailable"));
    const authorId = ticket.agentId ?? "";
    const author = { id: authorId, model: candidates.find((candidate) => candidate.id === authorId)?.model ?? null };
    const reviewer = pickTicketReviewer(candidates, author);
    if (!reviewer) throw new Error(sourceText("error.agent.boardTickets.noReviewer"));
    const brief = ticketReviewBrief(ticket, input, this.#evidence?.list(ticket.id) ?? []);
    const task = await startWorkThread(reviewer.id, brief, { title: `Review: ${ticket.title}` });
    this.#reviews.set(task.id, { ticketId: ticket.id, reviewerId: reviewer.id });
    this.patch(ticket.id, { phase: "review" }, "agent");
    this.comment(
      { ticketId: ticket.id, text: `Review of pull request #${input.pullRequest} requested from ${reviewer.name}.` },
      "agent",
    );
    return { reviewerId: reviewer.id, taskId: task.id };
  }

  /**
   * Ticket 239: the reviewer's verdict, from its review thread only. It is saved on the ticket with the
   * head commit it was given on. A FAIL sends the notes to the author thread; the third FAIL pauses the
   * loop and moves the ticket to Needs review for the person.
   */
  async submitVerdict(
    reviewTaskId: string,
    callerAgentId: string,
    input: { verdict: BoardTicketVerdict; headSha: string; notes: string },
  ): Promise<{ ticketId: string; fails: number; paused: boolean }> {
    const review = this.#reviews.get(reviewTaskId);
    if (!review || review.reviewerId !== callerAgentId) {
      throw new Error(sourceText("error.agent.boardTickets.notReviewThread"));
    }
    const ticket = this.#require(review.ticketId);
    if (ticket.agentId === callerAgentId) throw new Error(sourceText("error.agent.boardTickets.notReviewThread"));
    this.#store.addEvent(ticket.id, "verdict", "agent", {
      text: verdictEventText({ ...input, reviewerId: callerAgentId }).slice(0, BOARD_TICKET_COMMENT_LIMIT),
    });
    this.#reviews.delete(reviewTaskId);
    this.#changed([ticket.id]);
    const fails = boardTicketVerdicts(this.#store.events(ticket.id)).filter((item) => item.verdict === "FAIL").length;
    if (input.verdict !== "FAIL") return { ticketId: ticket.id, fails, paused: false };
    if (fails >= TICKET_REVIEW_FAIL_LIMIT) {
      this.comment(
        {
          ticketId: ticket.id,
          text: `The review failed ${fails} times. The loop is paused: please decide how to go on.`,
        },
        "agent",
      );
      this.moveIfNeeded(ticket.id, "needs_review", "agent");
      return { ticketId: ticket.id, fails, paused: true };
    }
    const owner = ticket.agentId;
    if (owner) {
      await this.#requestChanges(
        ticket,
        owner,
        `The reviewer said FAIL on ${input.headSha}. Fix it, push, and ask for a review again.\n${input.notes}`,
        "agent",
      );
    }
    return { ticketId: ticket.id, fails, paused: false };
  }

  /** The evidence of a ticket, oldest first. Empty when this board keeps none. */
  evidence(ticketId: string): BoardTicketEvidence[] {
    this.#require(ticketId);
    return this.#evidence?.list(ticketId) ?? [];
  }

  /** Attaches one piece of evidence to a ticket, and tells the view. */
  async attachEvidence(
    input: BoardTicketEvidenceInput,
    actor: BoardTicketActor = "user",
  ): Promise<BoardTicketEvidence> {
    this.#require(input.ticketId);
    if (!this.#evidence) throw new Error(sourceText("error.agent.boardTickets.startUnavailable"));
    const evidence = await this.#evidence.add(input, actor);
    this.#changed([input.ticketId]);
    return evidence;
  }

  /** The stored file of a screenshot or a recording, for Open. */
  evidenceFile(evidenceId: string): string | null {
    return this.#evidence?.filePath(evidenceId)?.path ?? null;
  }

  /** A screenshot as a data URL, for its thumbnail. */
  evidenceImage(evidenceId: string): Promise<string | null> {
    return this.#evidence ? this.#evidence.imageDataUrl(evidenceId) : Promise.resolve(null);
  }

  /** The ticket that a thread does: its work thread's ticket, or the ticket that the chat took (#263). */
  forThread(taskId: string | null, threadId: string | null): BoardTicket | null {
    const byTask = taskId ? this.#store.forTask(taskId) : null;
    if (byTask) return byTask;
    return threadId ? this.#store.forChatThread(threadId) : null;
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
    const patch: BoardTicketPatch = {};
    if (update.type !== undefined && ticket.typeSource !== "user" && update.type !== ticket.type) {
      patch.type = update.type;
      patch.typeSource = "agent";
    }
    if (update.error !== undefined) patch.error = nullableLine(update.error, BOARD_TICKET_ERROR_LIMIT);
    if (update.phase !== undefined && update.phase !== ticket.phase) patch.phase = update.phase;
    if (Object.keys(patch).length > 0) this.patch(ticket.id, patch, "agent");
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
    const current = this.#require(input.ticketId);
    const reassigned = patch.agentId !== undefined && patch.agentId !== current.agentId;
    // A reassign (ticket 247) ends the old agent's link: its run stays in the activity under its own agent, and
    // the new agent gets its own run. An active ticket starts the new agent now; any other waits for Start.
    if (reassigned && (current.taskId || current.threadId)) {
      patch.taskId = null;
      patch.threadId = null;
      patch.progress = null;
    }
    const updated = this.patch(input.ticketId, patch, actor);
    if (reassigned && patch.agentId && (current.taskId || current.threadId) && isActive(current.status)) {
      const agentId = patch.agentId;
      const previous = current.threadId;
      void this.#startNew({ ticketId: current.id, agentId }, updated, actor, previous).catch((error: unknown) => {
        this.patch(current.id, { error: nullableLine(String(error), BOARD_TICKET_ERROR_LIMIT) }, "agent");
      });
    }
    return updated;
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
    if (patch.phase && patch.phase !== current.phase) {
      this.#store.addEvent(ticketId, "phase", actor, { text: patch.phase });
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
    if (existing && input.changes) return await this.#requestChanges(existing, input.agentId, input.changes, actor);
    // One run per ticket (#263): a ticket that already has a run, from Start or from a chat, keeps it.
    if (existing && (existing.taskId || existing.threadId)) return this.get(existing.id) ?? existing;
    if (existing && this.#starting.has(existing.id)) {
      throw new Error(sourceText("error.agent.boardTickets.alreadyStarted"));
    }
    if (existing) this.#starting.add(existing.id);
    try {
      return await this.#startNew(input, existing, actor);
    } finally {
      if (existing) this.#starting.delete(existing.id);
    }
  }

  /**
   * Links a ticket to the agent chat that took it (#263): the chat's thread does the work, so no work
   * thread starts. The ticket moves to Running, and its activity says who took it.
   */
  bindChat(ticketId: string, agentId: string, threadId: string): BoardTicket {
    const ticket = this.#require(ticketId);
    if (ticket.taskId || ticket.threadId) return ticket;
    this.patch(ticketId, { agentId, threadId }, "agent");
    this.moveIfNeeded(ticketId, "running", "agent");
    return this.#require(ticketId);
  }

  /**
   * Request changes (ticket 248): the text goes to the run that did the work, under the agent that owns it.
   * When that run cannot take it (closed, deleted or never linked), a new run of the ticket's agent
   * starts with the request and the old thread as context. Any failure throws, so the view keeps the text.
   */
  async #requestChanges(
    ticket: BoardTicket,
    agentId: string,
    text: string,
    actor: BoardTicketActor,
  ): Promise<BoardTicket> {
    const send = this.#sendToWorkThread;
    if (!send) throw new Error(sourceText("error.agent.boardTickets.startUnavailable"));
    const owner = ticket.agentId ?? agentId;
    let sent = false;
    if (ticket.taskId) {
      const taskOwner = this.#taskOwner?.(ticket.taskId) ?? owner;
      sent = await send(taskOwner, ticket.taskId, text).then(
        () => true,
        () => false,
      );
    } else if (ticket.threadId) {
      // A ticket taken in a chat (ticket 263): its chat thread did the work.
      await send(owner, null, text);
      sent = true;
    }
    if (!sent) {
      const previous = ticket.threadId;
      this.patch(ticket.id, { taskId: null, threadId: null }, actor);
      await this.#startNew({ ticketId: ticket.id, agentId: owner }, this.#require(ticket.id), actor, previous, text);
    }
    this.comment({ ticketId: ticket.id, text }, actor);
    this.moveIfNeeded(ticket.id, "running", actor);
    return this.#require(ticket.id);
  }

  async #startNew(
    input: StartBoardTicketInput,
    existing: BoardTicket | null,
    actor: BoardTicketActor,
    previousThreadId: string | null = null,
    changes: string | null = null,
  ): Promise<BoardTicket> {
    const startWorkThread = this.#startWorkThread;
    if (!startWorkThread) throw new Error(sourceText("error.agent.boardTickets.startUnavailable"));
    const title = cleanTitle(existing?.title ?? input.title ?? "");
    const body = (existing ? existing.body : (input.body ?? "")).slice(0, BOARD_TICKET_BODY_LIMIT);
    const note = previousThreadId
      ? `\n\nThis ticket was reassigned to you. Earlier work is in thread ${previousThreadId}; read it for context.`
      : "";
    const request = changes ? `\n\nThe reviewer asked for changes:\n${changes}` : "";
    const task = await startWorkThread(input.agentId, `${workThreadText(title, body)}${note}${request}`, { title });
    const status: BoardTicketStatus = task.state === "running" ? "running" : "queued";
    const links = { taskId: task.id, threadId: task.threadId };
    if (!existing) return this.create({ title, body, status, agentId: input.agentId }, actor, links);
    this.patch(existing.id, { ...links, agentId: input.agentId }, actor);
    this.moveIfNeeded(existing.id, status, actor);
    return this.get(existing.id) ?? this.#require(existing.id);
  }

  /**
   * "take ticket N" in a chat (ticket 238): starts a work thread for the chat's agent with the brief that
   * the caller wrote, links it, and marks the ticket in the take phase.
   */
  async startFromChat(ticketId: string, agentId: string, brief: string): Promise<BoardTicket> {
    const startWorkThread = this.#startWorkThread;
    if (!startWorkThread) throw new Error(sourceText("error.agent.boardTickets.startUnavailable"));
    const ticket = this.#require(ticketId);
    const task = await startWorkThread(agentId, brief, { title: ticket.title });
    this.patch(ticket.id, { taskId: task.id, threadId: task.threadId, agentId, phase: "take" }, "agent");
    this.moveIfNeeded(ticket.id, task.state === "running" ? "running" : "queued", "agent");
    return this.#require(ticket.id);
  }

  delete(ticketId: string): void {
    if (!this.#store.delete(ticketId)) throw new Error(sourceText("error.agent.boardTickets.notFound"));
    void this.#evidence?.removeTicket(ticketId).catch(() => undefined);
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

/** A ticket whose work is under way, so a reassign starts the new agent at once. */
function isActive(status: BoardTicketStatus): boolean {
  return status === "running" || status === "queued";
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
