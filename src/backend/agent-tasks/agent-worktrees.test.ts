// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentWorktrees,
  repositoryRoot,
  ticketBranchName,
  ticketPathCandidates,
  worktreeRepository,
} from "./agent-worktrees";

// Failure mode (#262): parallel ticket agents share one checkout, so one agent's checkout or reset
// takes away another agent's edits, and the person's main checkout gets dirty.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function repository(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ticket-worktrees-")));
  roots.push(root);
  git(root, "init", "-q", "-b", "master");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "T");
  writeFileSync(join(root, "sub.js"), "export const sub = (a, b) => b - a;\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

describe("ticket worktrees", () => {
  it("gives three parallel tickets three worktrees and branches, and keeps the main checkout clean", async () => {
    const root = repository();
    const worktrees = new AgentWorktrees();
    const tasks = ["agent-task-aaaa-000000000001", "agent-task-bbbb-000000000002", "agent-task-cccc-000000000003"];
    const titles = ["Bug: sub.js returns wrong result", "Bug: mul.js", "Feature: add div.js"];
    const made = await Promise.all(
      tasks.map((taskId, index) =>
        Effect.runPromise(worktrees.prepare(root, taskId, ticketBranchName(titles[index] ?? "", taskId))),
      ),
    );
    const paths = made.map((workspace) => (workspace.mode === "worktree" ? workspace.path : ""));
    expect(paths.every((path) => path.length > 0)).toBe(true);
    expect(new Set(paths).size).toBe(3);
    expect(made.map((workspace) => (workspace.mode === "worktree" ? workspace.branch : ""))).toEqual([
      "ticket/bug-sub-js-returns-wrong-result-000001",
      "ticket/bug-mul-js-000002",
      "ticket/feature-add-div-js-000003",
    ]);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "branch", "--show-current")).toBe("master");

    // One agent edits its file; another agent resets and checks out a new branch in its own worktree.
    const [first, second] = paths;
    writeFileSync(join(first ?? "", "sub.js"), "export const sub = (a, b) => a - b;\n");
    git(second ?? "", "reset", "--hard", "HEAD");
    git(second ?? "", "checkout", "-q", "-b", "fix/other");
    expect(git(first ?? "", "status", "--porcelain")).toBe("M sub.js");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "branch", "--show-current")).toBe("master");
    expect(worktreeRepository(first ?? "")).toBe(root);
  });

  it("uses the same worktree again on a retry", async () => {
    const root = repository();
    const worktrees = new AgentWorktrees();
    const one = await Effect.runPromise(worktrees.prepare(root, "agent-task-x-000000000009", "ticket/a-000009"));
    const two = await Effect.runPromise(worktrees.prepare(root, "agent-task-x-000000000009", "ticket/a-000009"));
    expect(two).toEqual(one);
  });

  it("finds the repository that the ticket text names, labelled paths first", async () => {
    const root = repository();
    expect(ticketPathCandidates(`Fix /tmp/elsewhere/sub.js. Repo: ${root}. Run cd ${root} && node test.mjs`)).toEqual([
      root,
      "/tmp/elsewhere/sub.js",
    ]);
    expect(await repositoryRoot(join(root))).toBe(root);
    expect(await repositoryRoot(tmpdir())).toBeNull();
    expect(ticketBranchName("مرحبا", "agent-task-123456")).toBe("ticket/123456");
  });
});
