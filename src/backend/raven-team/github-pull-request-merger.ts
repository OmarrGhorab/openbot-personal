import type { RavenAutopilotMergeMethod } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";

/** The fetch that the merger uses. The app passes the platform fetch; a check passes a fake server. */
type GitHubMergeFetch = (url: string, init: RequestInit) => Promise<Response>;

const GITHUB_API_URL = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
const CHECK_RUNS_PER_PAGE = 100;

/** A pull request of the Reviewer's merge (#198): the repository and its number. */
export interface MergePullRequest {
  owner: string;
  repo: string;
  number: number;
}

/**
 * The state of a pull request that the merge rules read. `checks`: `green` when every check run and
 * commit status of the head ended well, `pending` while one runs, `failing` when one failed, `none`
 * when the head has none.
 */
export interface PullRequestMergeState {
  headSha: string;
  state: "open" | "closed" | "merged";
  checks: "green" | "pending" | "failing" | "none";
}

/**
 * Why a GitHub call of the merge failed. `not-connected`: no GitHub token. `head-moved`: GitHub refused the
 * merge because the head is not the commit that was passed. `refused`: any other answer. The failure never
 * holds a response body or a token.
 */
export class PullRequestMergeFailed extends Schema.TaggedError<PullRequestMergeFailed>()("PullRequestMergeFailed", {
  code: Schema.Literals(["not-connected", "head-moved", "refused"]),
  status: Schema.NullOr(Schema.Number),
}) {}

/** The GitHub operations of the Reviewer's merge. The engine reads this port; a check passes a fake. */
export interface PullRequestMerger {
  read(pr: MergePullRequest): Effect.Effect<PullRequestMergeState, PullRequestMergeFailed>;
  /** Merges the pull request only when its head is still `sha`: GitHub refuses it when a new commit came. */
  merge(pr: MergePullRequest, input: { sha: string; method: RavenAutopilotMergeMethod }): Effect.Effect<void, PullRequestMergeFailed>;
}

const pullSchema = Schema.Struct({
  state: Schema.String,
  merged: Schema.optional(Schema.Boolean),
  head: Schema.Struct({ sha: Schema.String }),
});
const checkRunsSchema = Schema.Struct({
  total_count: Schema.Number,
  check_runs: Schema.Array(Schema.Struct({ status: Schema.String, conclusion: Schema.NullOr(Schema.String) })),
});
const statusSchema = Schema.Struct({
  state: Schema.String,
  total_count: Schema.Number,
});

/** A check run that ended and did not fail. */
const GOOD_CONCLUSIONS: ReadonlySet<string> = new Set(["success", "neutral", "skipped"]);

export interface GitHubPullRequestMergerOptions {
  /** The user's GitHub token, or null when GitHub is not connected. Read at each call. */
  accessToken: () => Effect.Effect<string | null, unknown>;
  fetch: GitHubMergeFetch;
  /** The REST API root. The default is GitHub's API; a check points it at a local server. */
  apiUrl?: string;
}

/**
 * The GitHub REST adapter of the Reviewer's merge (#198). It reads a pull request, the check runs and the
 * commit status of its head, and merges it with the head commit as a precondition, so a commit that came
 * after the verdict stops the merge on GitHub's side too. The token stays in the request header: a failure
 * carries a code and a status, never a response body or the token.
 */
export class GitHubPullRequestMerger implements PullRequestMerger {
  readonly #options: GitHubPullRequestMergerOptions;
  readonly #apiUrl: string;

  constructor(options: GitHubPullRequestMergerOptions) {
    this.#options = options;
    this.#apiUrl = options.apiUrl ?? GITHUB_API_URL;
  }

  read(pr: MergePullRequest): Effect.Effect<PullRequestMergeState, PullRequestMergeFailed> {
    return Effect.gen({ self: this }, function* () {
      const token = yield* this.#token();
      const base = this.#repoUrl(pr);
      const pull = yield* this.#getJson(`${base}/pulls/${pr.number}`, token, pullSchema);
      const sha = encodeURIComponent(pull.head.sha);
      const runs = yield* this.#getJson(
        `${base}/commits/${sha}/check-runs?per_page=${CHECK_RUNS_PER_PAGE}`,
        token,
        checkRunsSchema,
      );
      const status = yield* this.#getJson(`${base}/commits/${sha}/status`, token, statusSchema);
      return {
        headSha: pull.head.sha,
        state: pull.merged ? "merged" : pull.state === "open" ? "open" : "closed",
        checks: combinedChecks(runs, status),
      } satisfies PullRequestMergeState;
    });
  }

  merge(
    pr: MergePullRequest,
    input: { sha: string; method: RavenAutopilotMergeMethod },
  ): Effect.Effect<void, PullRequestMergeFailed> {
    return Effect.gen({ self: this }, function* () {
      const token = yield* this.#token();
      const response = yield* this.#send(`${this.#repoUrl(pr)}/pulls/${pr.number}/merge`, token, {
        method: "PUT",
        body: JSON.stringify({ sha: input.sha, merge_method: input.method }),
      });
      if (response.ok) return;
      // 409: the head is not `sha`. GitHub answers so when a commit came after the verdict.
      return yield* new PullRequestMergeFailed({
        code: response.status === 409 ? "head-moved" : "refused",
        status: response.status,
      });
    });
  }

  #repoUrl(pr: MergePullRequest): string {
    return `${this.#apiUrl}/repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}`;
  }

  #token(): Effect.Effect<string, PullRequestMergeFailed> {
    return this.#options.accessToken().pipe(
      Effect.orElseSucceed(() => null),
      Effect.flatMap((token) =>
        token ? Effect.succeed(token) : Effect.fail(new PullRequestMergeFailed({ code: "not-connected", status: null })),
      ),
    );
  }

  #getJson<A>(url: string, token: string, schema: Schema.Codec<A>): Effect.Effect<A, PullRequestMergeFailed> {
    return Effect.gen({ self: this }, function* () {
      const response = yield* this.#send(url, token, { method: "GET" });
      if (!response.ok) return yield* new PullRequestMergeFailed({ code: "refused", status: response.status });
      const body = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new PullRequestMergeFailed({ code: "refused", status: response.status }),
      });
      return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(() => new PullRequestMergeFailed({ code: "refused", status: response.status })),
      );
    });
  }

  #send(
    url: string,
    token: string,
    request: { method: "GET" | "PUT"; body?: string },
  ): Effect.Effect<Response, PullRequestMergeFailed> {
    return Effect.tryPromise({
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
      catch: () => new PullRequestMergeFailed({ code: "refused", status: null }),
    });
  }
}

/** The CI of a head from its check runs and its commit status. One failure wins; one running check waits. */
function combinedChecks(
  runs: Schema.Schema.Type<typeof checkRunsSchema>,
  status: Schema.Schema.Type<typeof statusSchema>,
): PullRequestMergeState["checks"] {
  const hasStatuses = status.total_count > 0;
  // A head with more check runs than one page is not read as green: a check on page two could fail.
  if (runs.total_count > runs.check_runs.length) return "pending";
  if (runs.check_runs.length === 0 && !hasStatuses) return "none";
  const failed =
    runs.check_runs.some(
      (run) => run.status === "completed" && run.conclusion !== null && !GOOD_CONCLUSIONS.has(run.conclusion),
    ) ||
    (hasStatuses && (status.state === "failure" || status.state === "error"));
  if (failed) return "failing";
  const running = runs.check_runs.some((run) => run.status !== "completed") || (hasStatuses && status.state === "pending");
  return running ? "pending" : "green";
}
