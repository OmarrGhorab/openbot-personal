import type { BoardTicketStatus } from "@openbot/contracts/ipc";
import type { Effect } from "effect";
import type { TicketCandidate, TicketSourceFailed } from "../agent-tickets/ticket-source";

/**
 * An open issue of the sync target, as the ticket system gives it. Its fields are data. `labels` are its
 * labels, and for Jira its issue type too; the board detects the ticket type from them first.
 */
export type BoardTicketSyncIssue = Pick<TicketCandidate, "key" | "title" | "body" | "url" | "labels">;

/**
 * One ticket system that the Tickets board syncs with. Each method is one Effect; the adapter maps its
 * own errors to `TicketSourceFailed`.
 */
export interface BoardTicketSyncSource {
  /** The repositories or projects that the person can choose, such as `owner/repo` for GitHub. */
  projects(): Effect.Effect<string[], TicketSourceFailed>;
  /** Whether the text names a repository or project the way this system does. */
  isProject(project: string): boolean;
  /** The open issues of the repository or project, at most one page. */
  openIssues(project: string): Effect.Effect<BoardTicketSyncIssue[], TicketSourceFailed>;
  /** Posts a comment on the issue. */
  comment(key: string, text: string): Effect.Effect<void, TicketSourceFailed>;
  /** Gives the issue the state of the new column where the system has one. Otherwise it does nothing. */
  move(key: string, from: BoardTicketStatus, to: BoardTicketStatus): Effect.Effect<void, TicketSourceFailed>;
}
