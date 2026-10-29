import type { BoardTicketStatus } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { isGitHubProject } from "../agent-tickets/agent-ticket-watch";
import type { GitHubTicketSource } from "../agent-tickets/github-ticket-source";
import type { TicketSourceFailed } from "../agent-tickets/ticket-source";
import type { BoardTicketSyncIssue, BoardTicketSyncSource } from "./board-ticket-sync-source";

export interface GitHubBoardSyncSourceOptions {
  /** The GitHub adapter of the ticket intake. */
  issues: GitHubTicketSource;
  /** The repositories that the GitHub connection reaches, as `owner/repo`. */
  repositories: () => Effect.Effect<string[], TicketSourceFailed>;
}

/**
 * The board sync for GitHub, over the adapter of the ticket intake. A GitHub issue has two states, so a
 * ticket that goes to Done closes its issue, and a ticket that leaves Done opens it again. The other
 * columns have no GitHub state.
 */
export class GitHubBoardSyncSource implements BoardTicketSyncSource {
  readonly #options: GitHubBoardSyncSourceOptions;

  constructor(options: GitHubBoardSyncSourceOptions) {
    this.#options = options;
  }

  projects(): Effect.Effect<string[], TicketSourceFailed> {
    return this.#options.repositories();
  }

  isProject(project: string): boolean {
    return isGitHubProject(project);
  }

  openIssues(project: string): Effect.Effect<BoardTicketSyncIssue[], TicketSourceFailed> {
    return this.#options.issues.openIssues(project);
  }

  comment(key: string, text: string): Effect.Effect<void, TicketSourceFailed> {
    return this.#options.issues.comment({ key }, text);
  }

  move(key: string, from: BoardTicketStatus, to: BoardTicketStatus): Effect.Effect<void, TicketSourceFailed> {
    if (to === "done") return this.#options.issues.setState({ key }, "closed");
    if (from === "done") return this.#options.issues.setState({ key }, "open");
    return Effect.void;
  }
}
