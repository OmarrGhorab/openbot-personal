import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import type { AgentTicketWatch } from "./agent-ticket-watch";
import { type TicketCandidate, type TicketSource, TicketSourceFailed } from "./ticket-source";

/** The fetch that the adapter uses. The app passes the platform fetch; a test passes a fake server. */
type GitHubTicketFetch = (url: string, init: RequestInit) => Promise<Response>;

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
 * The GitHub adapter of the ticket intake. It lists the open issues of a watch's repository that
 * carry its label, and posts comments. Pull requests are left out. The adapter keeps the token in
 * the request header only: an error carries the status code, never the response body or the token.
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
    const token = yield* this.#token();
    const [owner, repo] = splitProject(watch.project);
    const url = `${this.#apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&labels=${encodeURIComponent(watch.label)}&per_page=${ISSUES_PER_POLL}`;
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
      key: `${watch.project.toLowerCase()}#${issue.number}`,
      title: issue.title,
      body: issue.body ?? "",
      url: issue.html_url,
    }));
  }).bind(this);

  readonly comment = Effect.fn("GitHubTicketSource.comment")(function* (
    this: GitHubTicketSource,
    ticket: Pick<TicketCandidate, "key">,
    text: string,
  ): Effect.fn.Return<void, TicketSourceFailed> {
    const match = GITHUB_KEY_PATTERN.exec(ticket.key);
    if (!match?.[1] || !match[2]) return yield* new TicketSourceFailed({ cause: new Error("Not a GitHub issue key.") });
    const [owner, repo] = splitProject(match[1]);
    const token = yield* this.#token();
    const url = `${this.#apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${match[2]}/comments`;
    yield* this.#send(url, { method: "POST", body: JSON.stringify({ body: text }) }, token);
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
    request: { method: "GET" | "POST"; body?: string },
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
