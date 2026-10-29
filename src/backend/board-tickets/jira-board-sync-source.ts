import type { BoardTicketStatus } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { TicketSourceFailed } from "../agent-tickets/ticket-source";
import type { BoardTicketSyncIssue, BoardTicketSyncSource } from "./board-ticket-sync-source";

/** A Jira project key, such as `PUU`: capital letters, digits and underscores, starting with a letter. */
const JIRA_PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,9}$/u;

/** A Jira site that the sign-in reaches. */
export interface AtlassianSite {
  cloudId: string;
  /** The address of the site, such as `https://example.atlassian.net`, for the link of an issue. */
  url: string;
}

/** An open issue as Jira gives it. */
export interface AtlassianIssue {
  key: string;
  summary: string;
  /** The description as Markdown, or empty. */
  description: string;
}

/** A workflow transition that an issue can take now, and the category of the status it reaches. */
export interface AtlassianTransition {
  id: string;
  /** `new` for To Do, `indeterminate` for In Progress, `done` for Done. */
  category: string;
}

/**
 * The calls of the Atlassian MCP server that the Jira sync needs. The adapter decodes each answer and
 * maps every failure to `TicketSourceFailed`.
 */
export interface AtlassianTools {
  /** The Jira sites that the sign-in reaches. */
  sites(): Effect.Effect<AtlassianSite[], TicketSourceFailed>;
  /** The keys of the projects that the person can see. */
  projects(cloudId: string): Effect.Effect<string[], TicketSourceFailed>;
  /** The issues of a project that are not in a Done status, newest first, at most one page. */
  openIssues(cloudId: string, project: string): Effect.Effect<AtlassianIssue[], TicketSourceFailed>;
  comment(cloudId: string, key: string, text: string): Effect.Effect<void, TicketSourceFailed>;
  transitions(cloudId: string, key: string): Effect.Effect<AtlassianTransition[], TicketSourceFailed>;
  transition(cloudId: string, key: string, transitionId: string): Effect.Effect<void, TicketSourceFailed>;
}

/**
 * The board sync for Jira, over the Atlassian MCP server that the person already signed in to. A Jira
 * issue has a workflow, so a ticket that goes to Done takes the transition into a Done status, and a
 * ticket that leaves Done takes the transition into a To Do status. An issue with no such transition stays
 * as it is. The other columns have no Jira state.
 */
export class JiraBoardSyncSource implements BoardTicketSyncSource {
  readonly #tools: AtlassianTools;
  #site: AtlassianSite | null = null;

  constructor(tools: AtlassianTools) {
    this.#tools = tools;
  }

  projects(): Effect.Effect<string[], TicketSourceFailed> {
    return this.#siteOnce().pipe(
      Effect.flatMap((site) => this.#tools.projects(site.cloudId)),
      Effect.map((keys) => keys.filter((key) => JIRA_PROJECT_KEY.test(key))),
    );
  }

  isProject(project: string): boolean {
    return JIRA_PROJECT_KEY.test(project);
  }

  openIssues(project: string): Effect.Effect<BoardTicketSyncIssue[], TicketSourceFailed> {
    if (!this.isProject(project)) return Effect.succeed([]);
    return this.#siteOnce().pipe(
      Effect.flatMap((site) =>
        this.#tools.openIssues(site.cloudId, project).pipe(
          Effect.map((issues) =>
            issues.map(
              (issue): BoardTicketSyncIssue => ({
                key: issue.key,
                title: issue.summary || issue.key,
                body: issue.description,
                url: `${site.url}/browse/${issue.key}`,
              }),
            ),
          ),
        ),
      ),
    );
  }

  comment(key: string, text: string): Effect.Effect<void, TicketSourceFailed> {
    return this.#siteOnce().pipe(Effect.flatMap((site) => this.#tools.comment(site.cloudId, key, text)));
  }

  move(key: string, from: BoardTicketStatus, to: BoardTicketStatus): Effect.Effect<void, TicketSourceFailed> {
    const category = to === "done" ? "done" : from === "done" ? "new" : null;
    if (category === null) return Effect.void;
    return this.#siteOnce().pipe(
      Effect.flatMap((site) =>
        this.#tools.transitions(site.cloudId, key).pipe(
          Effect.flatMap((transitions) => {
            const match = transitions.find((transition) => transition.category === category);
            return match ? this.#tools.transition(site.cloudId, key, match.id) : Effect.void;
          }),
        ),
      ),
    );
  }

  /** The first site that the sign-in reaches, read once for the life of the source. */
  #siteOnce(): Effect.Effect<AtlassianSite, TicketSourceFailed> {
    const known = this.#site;
    if (known) return Effect.succeed(known);
    return this.#tools.sites().pipe(
      Effect.flatMap((sites) => {
        const site = sites[0];
        if (!site) return Effect.fail(new TicketSourceFailed({ cause: new Error("No Jira site.") }));
        this.#site = site;
        return Effect.succeed(site);
      }),
    );
  }
}
