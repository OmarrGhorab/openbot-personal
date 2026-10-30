import {
  BOARD_TICKET_TITLE_LIMIT,
  type BoardTicket,
  type BoardTicketTeamFailure,
  type BoardTicketTeamStep,
  boardTicketTeamJobStep,
  boardTicketTeamRoleStep,
  type RavenTeamJob,
  type RavenTeamRoleRun,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import type { BoardTicketService } from "./board-ticket-service";
import type { BoardTicketPatch } from "./board-ticket-store";

const logger = createOpenBotLogger("board-tickets");

/**
 * Gives each Raven Stack team job its own ticket on the board, and each role of the job (Architect,
 * Builder, Reviewer and so on) its own ticket, linked to the job and assigned to the role's agent. The
 * composition root hands it the job after each change of the job.
 *
 * The job's ticket follows the job: Queued while it waits for a slot, Running, Needs review while it
 * waits for the person, Done when it passes, and Backlog with a failure line when it is stopped or ends
 * not done. A role ticket follows the job until the role's work thread starts; from then on
 * `BoardTicketWorkFollower` moves it with the thread, as it moves every ticket of a work thread. When
 * the job passes, every role ticket goes to Done.
 *
 * Like the work follower, it moves a ticket only when the column that the job asks for changes, so a
 * card that the person dragged stays where they put it. It owns no table: it writes through
 * `BoardTicketService`.
 */
export class BoardTicketTeamFollower {
  readonly #board: BoardTicketService;
  /** The column and failure that each job ticket (`jobId`) and role ticket (`jobId/roleId`) last asked for. */
  readonly #asked = new Map<string, string>();

  constructor(board: BoardTicketService) {
    this.#board = board;
  }

  follow(job: RavenTeamJob): void {
    try {
      this.#followJob(job);
    } catch (error) {
      logger.warn("Could not move the tickets of a team job.", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #followJob(job: RavenTeamJob): void {
    const tickets = this.#board.forTeamJob(job.id);
    const title = jobTitle(job);
    const step = boardTicketTeamJobStep(job);
    const jobTicket =
      tickets.find((ticket) => ticket.teamRoleId === null) ??
      this.#adoptDecisionTicket(job) ??
      this.#board.create({ title, body: job.brief, status: step.status }, "agent", { teamJobId: job.id });
    this.#apply(jobTicket.id, job.id, step);
    for (const role of job.roles) this.#followRole(job, role, title, tickets);
  }

  /**
   * An Autopilot job works on a ticket that is already on the board. That ticket becomes the job's own
   * ticket, so the board shows one card with the decision, not a second card for the same work.
   */
  #adoptDecisionTicket(job: RavenTeamJob): BoardTicket | null {
    const ticketId = job.decision?.ticketId;
    if (!ticketId) return null;
    const ticket = this.#board.get(ticketId);
    if (!ticket || (ticket.teamJobId !== null && ticket.teamJobId !== job.id)) return null;
    return this.#board.patch(ticket.id, { teamJobId: job.id }, "agent");
  }

  #followRole(job: RavenTeamJob, role: RavenTeamRoleRun, title: string, tickets: readonly BoardTicket[]): void {
    const key = `${job.id}/${role.roleId}`;
    const step = boardTicketTeamRoleStep(job, role);
    const existing = tickets.find((ticket) => ticket.teamRoleId === role.roleId);
    if (!existing) {
      const created = this.#board.create(
        {
          title: roleTitle(role.label, title),
          status: step?.status ?? (role.state === "working" ? "running" : "needs_review"),
          agentId: role.agentId,
        },
        "agent",
        { teamJobId: job.id, teamRoleId: role.roleId, taskId: role.taskId, threadId: role.threadId },
      );
      if (step) this.#apply(created.id, key, step);
      return;
    }
    const links: BoardTicketPatch = {};
    if (existing.agentId !== role.agentId) links.agentId = role.agentId;
    if (existing.taskId !== role.taskId) {
      links.taskId = role.taskId;
      links.threadId = role.threadId;
    }
    if (Object.keys(links).length > 0) this.#board.patch(existing.id, links, "agent");
    if (step) {
      this.#apply(existing.id, key, step);
      return;
    }
    // The role's work thread moves the ticket from here. The first turn of a new thread runs now.
    this.#asked.delete(key);
    if (links.taskId !== undefined && role.state === "working") {
      if (existing.error !== null) this.#board.patch(existing.id, { error: null }, "agent");
      this.#board.moveIfNeeded(existing.id, "running", "agent");
    }
  }

  #apply(ticketId: string, key: string, step: BoardTicketTeamStep): void {
    const asked = `${step.status}/${step.failure ?? ""}`;
    if (this.#asked.get(key) === asked) return;
    this.#asked.set(key, asked);
    const ticket = this.#board.get(ticketId);
    if (!ticket) return;
    // Done is the end of the job or the person's approval: only a job that runs again takes a ticket out.
    if (ticket.status === "done" && step.status !== "running") return;
    const error = step.failure === null ? null : failureLine(step.failure);
    if (error !== ticket.error) this.#board.patch(ticket.id, { error }, "agent");
    this.#board.moveIfNeeded(ticket.id, step.status, "agent", error);
  }
}

/** The first line of the job's ticket text, as the title of its ticket. */
function jobTitle(job: RavenTeamJob): string {
  const line = job.brief
    .split("\n")
    .map((part) => part.replace(/\s+/gu, " ").trim())
    .find((part) => part.length > 0);
  return (line ?? job.id).slice(0, BOARD_TICKET_TITLE_LIMIT);
}

/** A role ticket's title: the role, then the job's title, such as "Builder: Fix the login timeout". */
function roleTitle(label: string, title: string): string {
  return `${label.trim()}: ${title}`.slice(0, BOARD_TICKET_TITLE_LIMIT);
}

function failureLine(failure: BoardTicketTeamFailure): string {
  return failure === "stopped"
    ? sourceText("error.agent.boardTickets.teamJobStopped")
    : sourceText("error.agent.boardTickets.teamJobNotDone");
}
