import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const GITHUB_API_URL = "https://api.github.com";
const PUSH_TIMEOUT_MS = 120_000;

/** The fetch that the opener uses, so a check can point it at a local server. */
export type TicketPullFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface TicketPullRequestOpenerOptions {
  /** The user's GitHub token, or null when GitHub is not connected. Read at each call. */
  accessToken: () => Promise<string | null>;
  fetch: TicketPullFetch;
  /** The REST API root. The default is GitHub's API. */
  apiUrl?: string;
  /** The URL that a branch is pushed to. The default is the repository on github.com. */
  remoteUrl?: (owner: string, repo: string) => string;
}

export interface OpenTicketPullRequestInput {
  worktreePath: string;
  branch: string;
  /** The GitHub issue key, such as `acme/shop#12`. */
  issueKey: string;
  title: string;
  body: string;
  /** Short lines about the ticket's evidence, added under the body. */
  evidence: readonly string[];
}

/** A step of the open that failed, with no token or response body in it. */
export class TicketPullRequestFailed extends Error {
  constructor(readonly step: "token" | "issue" | "push" | "repository" | "create") {
    super(`Opening the pull request failed at the ${step} step.`);
  }
}

/**
 * Ticket 240: pushes a ticket's worktree branch and opens its pull request on GitHub, with `Fixes #N` and
 * the evidence lines. The token goes in a header for both git and the API, never in a URL, an argument
 * that a log keeps, or an error. Git never prompts. It runs in the worktree only, never the main checkout.
 */
export class TicketPullRequestOpener {
  readonly #options: TicketPullRequestOpenerOptions;

  constructor(options: TicketPullRequestOpenerOptions) {
    this.#options = options;
  }

  async open(input: OpenTicketPullRequestInput): Promise<{ number: number; url: string; project: string }> {
    const issue = /^([\w.-]+)\/([\w.-]+)#(\d{1,9})$/u.exec(input.issueKey);
    if (!issue) throw new TicketPullRequestFailed("issue");
    const [, owner = "", repo = "", number = ""] = issue;
    const token = await this.#options.accessToken();
    if (!token) throw new TicketPullRequestFailed("token");
    const remote = this.#options.remoteUrl?.(owner, repo) ?? `https://github.com/${owner}/${repo}.git`;
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    await run(
      "git",
      ["-C", input.worktreePath, "-c", "credential.helper=", "push", remote, `HEAD:refs/heads/${input.branch}`],
      {
        timeout: PUSH_TIMEOUT_MS,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          // The header reaches git through its environment config, not the command line.
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.extraHeader",
          GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
        },
      },
    ).catch(() => {
      throw new TicketPullRequestFailed("push");
    });
    const api = this.#options.apiUrl ?? GITHUB_API_URL;
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    };
    const repository = await this.#options.fetch(`${api}/repos/${owner}/${repo}`, { method: "GET", headers });
    const base = repository.ok ? await repository.json() : null;
    const defaultBranch =
      base && typeof base === "object" && "default_branch" in base && typeof base.default_branch === "string"
        ? base.default_branch
        : null;
    if (!defaultBranch) throw new TicketPullRequestFailed("repository");
    const body = [
      input.body.trim(),
      "",
      `Fixes #${number}`,
      ...(input.evidence.length > 0 ? ["", "Evidence:", ...input.evidence] : []),
    ].join("\n");
    const created = await this.#options.fetch(`${api}/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: input.title, head: input.branch, base: defaultBranch, body }),
    });
    const pull = created.ok ? await created.json() : null;
    if (
      !pull ||
      typeof pull !== "object" ||
      !("number" in pull) ||
      typeof pull.number !== "number" ||
      !("html_url" in pull) ||
      typeof pull.html_url !== "string"
    ) {
      throw new TicketPullRequestFailed("create");
    }
    return { number: pull.number, url: pull.html_url, project: `${owner}/${repo}` };
  }
}
