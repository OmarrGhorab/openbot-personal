// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ticketBranchName } from "../agent-tasks/agent-worktrees";
import { TicketPullRequestOpener } from "./ticket-pull-request-opener";

// Failure modes of ticket 240: the agent improvises push and gh; the token lands in a URL or an error;
// the pull request misses `Fixes #N`; a failure leaves no clear step; the branch is not ticket/<N>-<slug>.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function repos() {
  const root = mkdtempSync(join(tmpdir(), "ticket-pr-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "T");
  writeFileSync(join(work, "add.js"), "export const add = (a, b) => a + b;\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "fix add");
  return { remote, work };
}

describe("ticket pull request opener", () => {
  it("names a GitHub ticket's branch ticket/<N>-<slug>", () => {
    expect(ticketBranchName("acme/shop#12: Checkout fails on Safari", "agent-task-abcdef123456")).toBe(
      "ticket/12-checkout-fails-on-safari",
    );
    expect(ticketBranchName("Polish header", "agent-task-abcdef123456")).toBe("ticket/polish-header-123456");
  });

  it("pushes the worktree branch and opens the pull request with Fixes #N and the evidence", async () => {
    const { remote, work } = repos();
    const calls: { url: string; init: RequestInit }[] = [];
    const opener = new TicketPullRequestOpener({
      accessToken: async () => "secret-token",
      remoteUrl: () => remote,
      apiUrl: "http://github.test",
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith("/repos/acme/shop")) return Response.json({ default_branch: "main" });
        return Response.json({ number: 34, html_url: "https://github.com/acme/shop/pull/34" }, { status: 201 });
      },
    });

    const opened = await opener.open({
      worktreePath: work,
      branch: "ticket/12-checkout-fails",
      issueKey: "acme/shop#12",
      title: "Fix checkout",
      body: "Checkout works again.",
      evidence: ["- after test_output: 3 passed"],
    });

    expect(opened).toEqual({ number: 34, url: "https://github.com/acme/shop/pull/34", project: "acme/shop" });
    expect(git(remote, "rev-parse", "ticket/12-checkout-fails")).toBe(git(work, "rev-parse", "HEAD"));
    const body = JSON.parse(String(calls[1]?.init.body));
    expect(body).toMatchObject({ head: "ticket/12-checkout-fails", base: "main", title: "Fix checkout" });
    expect(body.body).toContain("Fixes #12");
    expect(body.body).toContain("3 passed");
    expect(calls.every((call) => !call.url.includes("secret-token"))).toBe(true);
  });

  it("fails at a named step, with no token in the error", async () => {
    const { work } = repos();
    const opener = new TicketPullRequestOpener({
      accessToken: async () => "secret-token",
      remoteUrl: () => join(work, "missing.git"),
      fetch: async () => Response.json({}),
    });
    const input = {
      worktreePath: work,
      branch: "ticket/1-x",
      issueKey: "acme/shop#1",
      title: "x",
      body: "",
      evidence: [],
    };
    await expect(opener.open(input)).rejects.toMatchObject({ step: "push" });
    await expect(opener.open({ ...input, issueKey: "PROJ-1" })).rejects.toMatchObject({ step: "issue" });
    const noToken = new TicketPullRequestOpener({
      accessToken: async () => null,
      fetch: async () => Response.json({}),
    });
    await expect(noToken.open(input)).rejects.toMatchObject({ step: "token" });
    await expect(opener.open(input)).rejects.not.toThrow(/secret-token/u);
  });
});
