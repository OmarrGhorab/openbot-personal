import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import type { AgentTicketStore } from "./agent-ticket-store";
import type { AgentTicketWatch, TicketProvider } from "./agent-ticket-watch";
import { ticketBrief } from "./ticket-brief";
import type { TicketCandidate, TicketSource, TicketSourceFailed } from "./ticket-source";

const logger = createOpenBotLogger("agent-tickets");

/** A work thread could not start. It never carries the ticket text. */
export class TicketIntakeFailed extends Schema.TaggedError<TicketIntakeFailed>()("TicketIntakeFailed", {
  cause: Schema.Defect(),
}) {}

export interface AgentTicketIntakeOptions {
  store: AgentTicketStore;
  /** The adapter of each provider that has an intake. A provider without one is skipped. */
  sources: Partial<Record<TicketProvider, TicketSource>>;
  /** Starts a work thread of the agent with the first message. The composition root gives `AgentService.startTask`. */
  startTask(agentId: string, text: string): Effect.Effect<{ taskId: string }, TicketIntakeFailed>;
  /** The agent name, for the comment on the ticket. Null when the agent is gone. */
  agentName(agentId: string): string | null;
}

/**
 * Starts one work thread for each new ticket that matches a watch, and comments on the ticket.
 *
 * The poll is deterministic: it makes no model call. A ticket is reserved in the store before its
 * task starts, so a second poll, or a second process, never starts it again. A start that fails
 * drops the reservation, so the next poll tries again. A failed comment is logged and does not undo
 * the start.
 *
 * It never imports the agent service.
 */
export class AgentTicketIntake {
  readonly #options: AgentTicketIntakeOptions;

  constructor(options: AgentTicketIntakeOptions) {
    this.#options = options;
  }

  /** One pass over the enabled watches. A failing watch or ticket does not stop the others. */
  readonly poll = Effect.fn("AgentTicketIntake.poll")(function* (this: AgentTicketIntake) {
    for (const watch of this.#options.store.enabledWatches()) {
      const source = this.#options.sources[watch.provider];
      if (!source) continue;
      const candidates = yield* source.list(watch).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            logWatchFailure(watch, failure);
            return [];
          }),
        ),
      );
      for (const ticket of candidates) yield* this.#intake(watch, source, ticket);
    }
  }).bind(this);

  readonly #intake = Effect.fn("AgentTicketIntake.intake")(function* (
    this: AgentTicketIntake,
    watch: AgentTicketWatch,
    source: TicketSource,
    ticket: TicketCandidate,
  ) {
    const { store, startTask, agentName } = this.#options;
    if (!store.reserve(watch.agentId, watch.provider, ticket.key)) return;
    const started = yield* startTask(watch.agentId, ticketBrief(ticket)).pipe(Effect.result);
    if (Result.isFailure(started)) {
      store.release(watch.agentId, watch.provider, ticket.key);
      logger.warn("Could not start a work thread for a ticket. The next poll tries again.", {
        provider: watch.provider,
        ticket: ticket.key,
      });
      return;
    }
    const taskId = started.success.taskId;
    store.attachTask(watch.agentId, watch.provider, ticket.key, taskId);
    logger.info("Started a work thread for a ticket.", { provider: watch.provider, ticket: ticket.key });
    const name = agentName(watch.agentId) ?? "OpenBot";
    yield* source.comment(ticket, startedComment(name, taskId)).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          logger.warn("Could not comment on a ticket after its work thread started.", {
            provider: watch.provider,
            ticket: ticket.key,
            reason: failureCause(failure),
          });
        }),
      ),
    );
  }).bind(this);
}

/**
 * The comment that the intake posts when a work thread starts. It is English on purpose: it goes to a
 * third-party ticket, not into OpenBot's interface (see the PR for this default).
 */
function startedComment(agentName: string, taskId: string): string {
  return `OpenBot started a work thread for this ticket. Agent: ${agentName}. Work thread: ${taskId}.`;
}

function logWatchFailure(watch: AgentTicketWatch, failure: TicketSourceFailed): void {
  logger.warn("Could not list tickets for a watch. The next poll tries again.", {
    provider: watch.provider,
    reason: failureCause(failure),
  });
}

/**
 * The fixed text that the adapters give a failure. A schema or parse error can quote the response,
 * so the log never takes the text of a cause.
 */
function failureCause(failure: TicketSourceFailed): string {
  return failure.cause instanceof Error ? failure.cause.message : "The ticket system request failed.";
}
