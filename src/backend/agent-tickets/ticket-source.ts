import { type Effect, Schema } from "effect";
import type { AgentTicketWatch, TicketProvider } from "./agent-ticket-watch";

/** A ticket that matches a watch. The fields are the ticket system's text, so they are data. */
export interface TicketCandidate {
  provider: TicketProvider;
  /** The stable ID of the ticket in its system, such as `owner/repo#12` for GitHub. */
  key: string;
  title: string;
  body: string;
  /** The page of the ticket, for the agent and the comment. */
  url: string;
}

/** A failed call to a ticket system. It keeps the cause private: it never holds a token or a response body. */
export class TicketSourceFailed extends Schema.TaggedError<TicketSourceFailed>()("TicketSourceFailed", {
  cause: Schema.Defect(),
}) {}

/** One ticket system. Each method is one Effect; the adapter maps its own errors to `TicketSourceFailed`. */
export interface TicketSource {
  /** The open tickets of the watch that carry its label, at most one page. Pull requests are left out. */
  list(watch: AgentTicketWatch): Effect.Effect<TicketCandidate[], TicketSourceFailed>;
  /** Posts a comment on the ticket. */
  comment(ticket: Pick<TicketCandidate, "key">, text: string): Effect.Effect<void, TicketSourceFailed>;
}
