import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  BOARD_TICKET_BODY_LIMIT,
  BOARD_TICKET_TITLE_LIMIT,
  type BoardTicket,
  type BoardTicketProvider,
  detectBoardTicketType,
  detectTicketTakeRequest,
  type RavenAutopilotChat,
  type RavenTeamJob,
  type RavenTicketTakeResult,
  type TakeRavenTicketInput,
  type TicketTakeReference,
  ticketReferenceMatches,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect, Result } from "effect";
import type { BoardTicketService } from "../board-tickets/board-ticket-service";

const logger = createOpenBotLogger("ticket-take");

const FIX_INTENT = /(?:^|[^\p{L}])(?:fix|repair|resolve|debug|صلح|صلّح|اصلح|أصلح)(?=$|[^\p{L}])/iu;

/** The board operations a take uses. */
export type TicketTakeBoard = Pick<BoardTicketService, "list" | "get" | "create">;

/** The sync operations a take uses: which systems are connected, and the import of one issue by key. */
export interface TicketTakeSync {
  connected(): readonly BoardTicketProvider[];
  importIssueByKey(provider: BoardTicketProvider, key: string): Effect.Effect<string | null, unknown>;
}

export interface TicketTakeOptions {
  board: TicketTakeBoard;
  sync: TicketTakeSync;
  /** The Autopilot engine's start of one ticket for a chat (#196 `takeNow`). */
  take(
    ticketId: string,
    chat: RavenAutopilotChat,
  ): Effect.Effect<{ job: RavenTeamJob; already: boolean } | { reason: string }>;
  /** The conversation thread of an agent of this computer, or null. Undefined: no such agent. */
  agentThread(agentId: string): string | null | undefined;
}

/**
 * Chat (#200): an agent takes the ticket that a message names. The message is read here, in main or the
 * backend, never trusted from the renderer.
 *
 * 1. The message must name a ticket (a GitHub, Jira or Linear link or key) and ask to take it.
 * 2. A board ticket linked to that issue is used. Otherwise the issue's system must be connected: without
 *    it, the answer asks the person to connect it. With it, the issue is imported from its repository or
 *    project; an issue that is not open there gets a new Backlog ticket linked to it.
 * 3. The Autopilot engine starts the job at once, with the asking agent and thread in its decision.
 */
export class TicketTakeService {
  readonly #options: TicketTakeOptions;

  constructor(options: TicketTakeOptions) {
    this.#options = options;
  }

  take(input: TakeRavenTicketInput): Effect.Effect<RavenTicketTakeResult> {
    return Effect.gen({ self: this }, function* () {
      const reference = detectTicketTakeRequest(input.text);
      if (!reference) return { outcome: "none" } as const;
      const thread = this.#options.agentThread(input.agentId);
      if (thread === undefined) {
        return { outcome: "failed", key: reference.key, reason: sourceText("error.agent.ticketTake.noAgent") } as const;
      }
      // The decision keeps an identifier only, so a job never fails its decoder for an odd thread id.
      const threadId = thread && thread.length <= INPUT_LIMITS.identifier ? thread : null;
      const found = yield* this.#ticketFor(reference, input.text);
      if ("outcome" in found) return found;
      const started = yield* this.#options.take(found.ticket.id, { agentId: input.agentId, threadId });
      if ("reason" in started) {
        return { outcome: "failed", key: reference.key, reason: redactText(started.reason) } as const;
      }
      return {
        outcome: "taken",
        jobId: started.job.id,
        ticketId: found.ticket.id,
        key: found.ticket.external?.key ?? reference.key,
        provider: found.ticket.external?.provider ?? reference.provider,
        already: started.already,
      } as const;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logger.warn("A chat ticket take failed.", { cause: redactText(String(cause)) });
          return { outcome: "failed", key: "", reason: sourceText("error.agent.ticketTake.failed") } as const;
        }),
      ),
    );
  }

  /** The board ticket of the reference: on the board, imported, or new in Backlog. */
  #ticketFor(
    reference: TicketTakeReference,
    text: string,
  ): Effect.Effect<{ ticket: BoardTicket } | RavenTicketTakeResult> {
    return Effect.gen({ self: this }, function* () {
      const { board, sync } = this.#options;
      const onBoard = () => board.list().find((ticket) => ticketReferenceMatches(reference, ticket.external));
      const existing = onBoard();
      if (existing) return { ticket: existing };
      const connected = sync.connected();
      // A bare key with no system named is Jira's when Jira is connected; Linear has no connection yet.
      const provider: BoardTicketProvider = reference.provider ?? "jira";
      if (!connected.includes(provider)) return { outcome: "connect", key: reference.key, provider } as const;
      const imported = yield* Effect.result(sync.importIssueByKey(provider, reference.key));
      if (Result.isSuccess(imported) && imported.success !== null) {
        const ticket = onBoard();
        if (ticket) return { ticket };
      }
      if (Result.isFailure(imported)) {
        logger.warn("Could not read the issue of a chat ticket take.", { provider });
      }
      // Not open in its project, or the read failed: a Backlog ticket linked to the issue, so a later sync
      // finds it and does not add a second one.
      const title = reference.key.slice(0, BOARD_TICKET_TITLE_LIMIT);
      const body = redactText(text).slice(0, BOARD_TICKET_BODY_LIMIT);
      // "fix it" asks for a fix: a Bug, when the text says nothing else. The engine needs a type to decide.
      const type = detectBoardTicketType({ title: body, body }) ?? (FIX_INTENT.test(text) ? "bug" : null);
      const ticket = board.create(
        { title, body, ...(type ? { type } : {}) },
        "agent",
        reference.url ? { external: { provider, key: reference.key, url: reference.url } } : {},
      );
      return { ticket };
    });
  }
}
