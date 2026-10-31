import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type BoardTicket,
  type BoardTicketProvider,
  detectLocalTicketTake,
  detectTicketTakeRequest,
  matchLocalTicket,
  type RavenTicketTakeResult,
  type TakeRavenTicketInput,
  type TicketTakeReference,
  ticketReferenceMatches,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect, Result } from "effect";
import { ticketFactoryBrief } from "../agent-tickets/ticket-factory-brief";
import type { BoardTicketService } from "../board-tickets/board-ticket-service";

/** A ticket whose work is under way. */
function isActive(status: BoardTicket["status"]): boolean {
  return status === "running" || status === "queued";
}

const logger = createOpenBotLogger("ticket-take");

/** The board operations a take uses. */
type TicketTakeBoard = Pick<BoardTicketService, "list" | "get" | "create" | "bindChat" | "startFromChat">;

/** The sync operations a take uses: which systems are connected, and the import of one issue by key. */
interface TicketTakeSync {
  connected(): readonly BoardTicketProvider[];
  importIssueByKey(provider: BoardTicketProvider, key: string): Effect.Effect<string | null, unknown>;
}

export interface TicketTakeOptions {
  board: TicketTakeBoard;
  sync: TicketTakeSync;
  /** The conversation thread of an agent of this computer, or null. Undefined: no such agent. */
  agentThread(agentId: string): string | null | undefined;
}

/**
 * Chat (#200): an agent takes the ticket that a message names. The message is read here, in main or the
 * backend, never trusted from the renderer.
 *
 * 1. The message must name a GitHub issue (a link or `owner/repo#N`) and ask to take it. Another system's
 *    key gets a clear answer: chat takes GitHub issues only (ticket 238).
 * 2. A board ticket linked to that issue is used. Otherwise GitHub must be connected, and the issue is
 *    imported from its repository. A closed issue, a Done ticket, or a ticket already running elsewhere is
 *    refused with a chat answer.
 * 3. A work thread of the chat's agent starts with a brief that loads the ticket-factory skill. The ticket
 *    links that thread, moves to Running and is in the take phase. No Raven team job starts.
 */
export class TicketTakeService {
  readonly #options: TicketTakeOptions;

  constructor(options: TicketTakeOptions) {
    this.#options = options;
  }

  take(input: TakeRavenTicketInput): Effect.Effect<RavenTicketTakeResult> {
    return Effect.gen({ self: this }, function* () {
      const reference = detectTicketTakeRequest(input.text);
      if (!reference) return yield* this.#takeLocal(input);
      const thread = this.#options.agentThread(input.agentId);
      if (thread === undefined) {
        return { outcome: "failed", key: reference.key, reason: sourceText("error.agent.ticketTake.noAgent") } as const;
      }
      // The decision keeps an identifier only, so a job never fails its decoder for an odd thread id.
      const threadId = thread && thread.length <= INPUT_LIMITS.identifier ? thread : null;
      if (threadId === null) {
        return { outcome: "failed", key: reference.key, reason: sourceText("error.agent.ticketTake.noAgent") } as const;
      }
      // Ticket 238: GitHub issues only. Another system's link gets a clear answer, not a team job.
      if (reference.provider !== "github") {
        return {
          outcome: "failed",
          key: reference.key,
          reason: sourceText("error.agent.ticketTake.githubOnly"),
        } as const;
      }
      const found = yield* this.#ticketFor(reference);
      if ("outcome" in found) return found;
      const ticket = found.ticket;
      const key = ticket.external?.key ?? reference.key;
      if (ticket.status === "done") {
        return { outcome: "failed", key, reason: sourceText("error.agent.ticketTake.closed") } as const;
      }
      if ((ticket.taskId || ticket.threadId || ticket.teamJobId) && isActive(ticket.status)) {
        return { outcome: "failed", key, reason: sourceText("error.agent.ticketTake.alreadyRunning") } as const;
      }
      const brief = ticketFactoryBrief({
        key,
        title: ticket.title,
        url: ticket.external?.url ?? null,
        body: ticket.body,
      });
      const started = yield* Effect.promise(() => this.#options.board.startFromChat(ticket.id, input.agentId, brief));
      return { outcome: "linked", ticketId: started.id, already: false, title: started.title } as const;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logger.warn("A chat ticket take failed.", { cause: redactText(String(cause)) });
          return { outcome: "failed", key: "", reason: sourceText("error.agent.ticketTake.failed") } as const;
        }),
      ),
    );
  }

  /**
   * A ticket of this board that the message names by its quoted title (#263). The chat that got the
   * message does the work, so the ticket is linked to that chat's thread and moves to Running. A ticket
   * that already has a run keeps it: nothing new starts, so the work is never done twice.
   */
  #takeLocal(input: TakeRavenTicketInput): Effect.Effect<RavenTicketTakeResult> {
    return Effect.sync((): RavenTicketTakeResult => {
      const take = detectLocalTicketTake(input.text);
      if (!take) return { outcome: "none" } as const;
      const ticket = matchLocalTicket(
        this.#options.board.list().filter((candidate) => candidate.status !== "done"),
        take,
      );
      if (!ticket) return { outcome: "none" } as const;
      if (ticket.taskId || ticket.threadId || ticket.teamJobId) {
        return { outcome: "linked", ticketId: ticket.id, already: true } as const;
      }
      const thread = this.#options.agentThread(input.agentId);
      if (thread === undefined) return { outcome: "none" } as const;
      const threadId = thread && thread.length <= INPUT_LIMITS.identifier ? thread : null;
      if (!threadId) return { outcome: "none" } as const;
      this.#options.board.bindChat(ticket.id, input.agentId, threadId);
      return { outcome: "linked", ticketId: ticket.id, already: false } as const;
    });
  }

  /**
   * The board ticket of a GitHub reference: on the board, or imported from the connected repository. An
   * issue that is not open there is refused as closed, and no ticket is added.
   */
  #ticketFor(reference: TicketTakeReference): Effect.Effect<{ ticket: BoardTicket } | RavenTicketTakeResult> {
    return Effect.gen({ self: this }, function* () {
      const { board, sync } = this.#options;
      const onBoard = () => board.list().find((ticket) => ticketReferenceMatches(reference, ticket.external));
      const existing = onBoard();
      if (existing) return { ticket: existing };
      if (!sync.connected().includes("github")) {
        return { outcome: "connect", key: reference.key, provider: "github" } as const;
      }
      const imported = yield* Effect.result(sync.importIssueByKey("github", reference.key));
      if (Result.isSuccess(imported) && imported.success !== null) {
        const ticket = onBoard();
        if (ticket) return { ticket };
      }
      if (Result.isFailure(imported)) {
        logger.warn("Could not read the issue of a chat ticket take.", { provider: "github" });
        return { outcome: "failed", key: reference.key, reason: sourceText("error.agent.ticketTake.failed") } as const;
      }
      return { outcome: "failed", key: reference.key, reason: sourceText("error.agent.ticketTake.closed") } as const;
    });
  }
}
