import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import type { AgentTicketWatch } from "./agent-ticket-watch";
import { type TicketCandidate, type TicketSource, TicketSourceFailed } from "./ticket-source";

/** The fetch that the adapter uses. The app passes the platform fetch; a test passes a fake server. */
type GitHubTicketFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The two states of a GitHub issue. The board sync closes an issue and opens it again. */
type GitHubIssueState = "open" | "closed";

const GITHUB_API_URL = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
/** The first page of open issues. A poll never starts more than this many tickets. */
const ISSUES_PER_POLL = 50;
const GITHUB_KEY_PATTERN = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)$/u;

const githubIssueSchema = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  html_url: Schema.String,
});
const githubIssuesSchema = Schema.Array(githubIssueSchema);

export interface GitHubTicketSourceOptions {
  /** The user's GitHub token, or null when GitHub is not connected. Read at each call. */
  accessToken: () => Effect.Effect<string | null, unknown>;
  fetch: GitHubTicketFetch;
  /** The REST API root. The default is GitHub's API; a test points it at a local server. */
  apiUrl?: string;
}

/**
 * The GitHub adapter of the ticket intake and of the board sync. It lists the open issues of a
 * repository, all of them or those that carry a watch's label, posts comments, and closes an issue or
 * opens it again. Pull requests are left out. The adapter keeps the token in the request header only:
 * an error carries the status code, never the response body or the token.
 */
export class GitHubTicketSource implements TicketSource {
  readonly #options: GitHubTicketSourceOptions;
  readonly #apiUrl: string;

  constructor(options: GitHubTicketSourceOptions) {
    this.#options = options;
    this.#apiUrl = options.apiUrl ?? GITHUB_API_URL;
  }

  readonly list = Effect.fn("GitHubTicketSource.list")(function* (
    this: GitHubTicketSource,
    watch: AgentTicketWatch,
  ): Effect.fn.Return<TicketCandidate[], TicketSourceFailed> {
    return yield* this.#issues(watch.project, watch.label);
  }).bind(this);

  /** The open issues of the repository with any label, at most one page. The board sync imports them. */
  readonly openIssues = Effect.fn("GitHubTicketSource.openIssues")(function* (
    this: GitHubTicketSource,
    project: string,
  ): Effect.fn.Return<TicketCandidate[], TicketSourceFailed> {
    return yield* this.#issues(project, null);
  }).bind(this);

  readonly comment = Effect.fn("GitHubTicketSource.comment")(function* (
    this: GitHubTicketSource,
    ticket: Pick<TicketCandidate, "key">,
    text: string,
  ): Effect.fn.Return<void, TicketSourceFailed> {
    const issueUrl = yield* this.#issueUrl(ticket.key);
    const token = yield* this.#token();
    yield* this.#send(`${issueUrl}/comments`, { method: "POST", body: JSON.stringify({ body: text }) }, token);
  }).bind(this);

  /** Closes the issue, or opens it again. */
  readonly setState = Effect.fn("GitHubTicketSource.setState")(function* (
    this: GitHubTicketSource,
    ticket: Pick<TicketCandidate, "key">,
    state: GitHubIssueState,
  ): Effect.fn.Return<void, TicketSourceFailed> {
    const issueUrl = yield* this.#issueUrl(ticket.key);
    const token = yield* this.#token();
    yield* this.#send(issueUrl, { method: "PATCH", body: JSON.stringify({ state }) }, token);
  }).bind(this);

  readonly #issues = Effect.fn("GitHubTicketSource.issues")(function* (
    this: GitHubTicketSource,
    project: string,
    label: string | null,
  ): Effect.fn.Return<TicketCandidate[], TicketSourceFailed> {
    const token = yield* this.#token();
    const [owner, repo] = splitProject(project);
    const labels = label === null ? "" : `&labels=${encodeURIComponent(label)}`;
    const url = `${this.#apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open${labels}&per_page=${ISSUES_PER_POLL}`;
    const response = yield* this.#send(url, { method: "GET" }, token);
    const raw = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new TicketSourceFailed({ cause: new Error("GitHub returned a response that is not JSON.") }),
    });
    // The issues endpoint also lists pull requests. They carry a `pull_request` key, and the intake skips them.
    const issues = Array.isArray(raw) ? raw.filter((item) => !isDynamicRecord(item) || !("pull_request" in item)) : raw;
    // The decode error can quote an issue, so the failure carries a fixed message.
    const decoded = yield* Schema.decodeUnknownEffect(githubIssuesSchema)(issues).pipe(
      Effect.mapError(() => new TicketSourceFailed({ cause: new Error("GitHub returned an unexpected response.") })),
    );
    return decoded.map((issue) => ({
      provider: "github",
      key: `${project.toLowerCase()}#${issue.number}`,
      title: issue.title,
      body: issue.body ?? "",
      url: issue.html_url,
    }));
  }).bind(this);

  /** The API address of the issue that a key such as `owner/repo#12` names. */
  readonly #issueUrl = Effect.fn("GitHubTicketSource.issueUrl")(function* (
    this: GitHubTicketSource,
    key: string,
  ): Effect.fn.Return<string, TicketSourceFailed> {
    const match = GITHUB_KEY_PATTERN.exec(key);
    if (!match?.[1] || !match[2]) return yield* new TicketSourceFailed({ cause: new Error("Not a GitHub issue key.") });
    const [owner, repo] = splitProject(match[1]);
    return `${this.#apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${match[2]}`;
  }).bind(this);

  readonly #token = Effect.fn("GitHubTicketSource.token")(function* (this: GitHubTicketSource) {
    const token = yield* this.#options
      .accessToken()
      .pipe(Effect.mapError(() => new TicketSourceFailed({ cause: new Error("GitHub is not connected.") })));
    if (!token) return yield* new TicketSourceFailed({ cause: new Error("GitHub is not connected.") });
    return token;
  }).bind(this);

  readonly #send = Effect.fn("GitHubTicketSource.send")(function* (
    this: GitHubTicketSource,
    url: string,
    request: { method: "GET" | "POST" | "PATCH"; body?: string },
    token: string,
  ) {
    const response = yield* Effect.tryPromise({
      try: () =>
        this.#options.fetch(url, {
          method: request.method,
          ...(request.body === undefined ? {} : { body: request.body }),
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            Authorization: `Bearer ${token}`,
            ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      catch: () => new TicketSourceFailed({ cause: new Error("GitHub could not be reached.") }),
    });
    if (!response.ok) return yield* new TicketSourceFailed({ cause: new Error(`GitHub returned ${response.status}.`) });
    return response;
  }).bind(this);
}

function splitProject(project: string): [string, string] {
  const [owner, repo] = project.split("/");
  if (!owner || !repo) throw new Error("A GitHub project is owner/repo.");
  return [owner, repo];
}
