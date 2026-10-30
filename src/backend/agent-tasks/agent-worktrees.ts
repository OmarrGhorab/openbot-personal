import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import { causeHelpers } from "../effect-boundary";
import type { AgentWorkThreadWorkspace } from "./agent-work-thread-store";

const run = promisify(execFile);
const logger = createOpenBotLogger("agent-worktrees");

/** The folder of the work-thread worktrees, relative to the agent workspace. */
const WORKTREE_FOLDER = ".openbot/worktrees";
/** The line that keeps the worktrees out of `git status` of the main checkout. */
const EXCLUDE_LINE = `/${WORKTREE_FOLDER}/`;
/** A git command that takes longer than this fails, and the work thread shares the workspace. */
const GIT_TIMEOUT_MS = 30_000;

class WorktreeOperationFailed extends Schema.TaggedError<WorktreeOperationFailed>()("WorktreeOperationFailed", {
  cause: Schema.Defect(),
}) {}

const { io: worktreeIo } = causeHelpers(WorktreeOperationFailed);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    // A credential prompt must never wait for input that no one gives.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

/** The short id of a task: the end of its UUID, safe in a path and a branch name. */
function worktreeName(taskId: string): string {
  const id = taskId.replace(/[^a-zA-Z0-9-]/g, "").slice(-12);
  return id.length > 0 ? id : "thread";
}

/**
 * Owns the git worktrees of work threads: one worktree per work thread, inside the agent workspace,
 * so two work threads of one agent never edit the same files. It never imports the service.
 *
 * Only a workspace that is the top level of a git repository gets worktrees. Every failure gives the
 * shared workspace, so a failed worktree never stops a task.
 */
export class AgentWorktrees {
  /**
   * Adds the worktree of the task, or gives the shared workspace. A worktree that already exists at
   * its path is used again, so a retry after a crash does not make a second one.
   */
  readonly prepare = Effect.fn("AgentWorktrees.prepare")(function* (
    this: AgentWorktrees,
    workspacePath: string,
    taskId: string,
    branchName?: string,
  ): Effect.fn.Return<AgentWorkThreadWorkspace> {
    const name = worktreeName(taskId);
    const path = join(workspacePath, WORKTREE_FOLDER, name);
    const branch = branchName ?? `openbot/${name}`;
    const result = yield* Effect.result(
      worktreeIo(async () => {
        const [top, workspace] = await Promise.all([
          git(workspacePath, ["rev-parse", "--show-toplevel"]).then((value) => realpath(value)),
          realpath(workspacePath),
        ]);
        if (top !== workspace) return null;
        // An empty repository has no commit to branch from.
        await git(workspacePath, ["rev-parse", "--verify", "HEAD"]);
        await excludeWorktrees(workspacePath);
        const listed = await git(workspacePath, ["worktree", "list", "--porcelain"]);
        const realPath = await realpath(path).catch(() => null);
        const known = listed
          .split("\n")
          .some((line) => line === `worktree ${path}` || (realPath !== null && line === `worktree ${realPath}`));
        if (!known) {
          await mkdir(join(workspacePath, WORKTREE_FOLDER), { recursive: true });
          const branchExists = await git(workspacePath, ["rev-parse", "--verify", `refs/heads/${branch}`]).then(
            () => true,
            () => false,
          );
          await git(
            workspacePath,
            branchExists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"],
          );
        }
        return path;
      }),
    );
    if (Result.isFailure(result)) {
      logger.info("A work thread shares the agent workspace: no git worktree.", {
        taskId,
        error: result.failure.cause,
      });
      return { mode: "shared" } as const;
    }
    return result.success === null ? ({ mode: "shared" } as const) : { mode: "worktree" as const, path, branch };
  });

  /**
   * Removes the worktree of a deleted work thread when it has no change. A worktree with changes, or
   * one that git cannot read, stays with its branch, so no work is lost. True when it was removed.
   */
  readonly remove = Effect.fn("AgentWorktrees.remove")(function* (
    this: AgentWorktrees,
    workspacePath: string,
    worktreePath: string,
  ): Effect.fn.Return<boolean> {
    const result = yield* Effect.result(
      worktreeIo(async () => {
        const status = await git(worktreePath, ["status", "--porcelain"]);
        if (status.length > 0) return false;
        await git(workspacePath, ["worktree", "remove", worktreePath]);
        return true;
      }),
    );
    if (Result.isFailure(result)) {
      logger.info("Kept the worktree of a deleted work thread.", { error: result.failure.cause });
      return false;
    }
    return result.success;
  });
}

/**
 * The top folder of the git repository that holds this path, or null when it is in none. A ticket names
 * its repository by a path in its text; the worktree of the ticket goes into that repository.
 */
export async function repositoryRoot(path: string): Promise<string | null> {
  try {
    return await realpath(await git(path, ["rev-parse", "--show-toplevel"]));
  } catch {
    return null;
  }
}

/** The repository that a managed worktree path belongs to, or null for any other path. */
export function worktreeRepository(worktreePath: string): string | null {
  const marker = `/${WORKTREE_FOLDER}/`;
  const index = worktreePath.replaceAll("\\", "/").lastIndexOf(marker);
  return index > 0 ? worktreePath.slice(0, index) : null;
}

/** The absolute paths that a ticket's text names, `Repo: /x` lines first, without trailing punctuation. */
export function ticketPathCandidates(text: string): string[] {
  const labelled: string[] = [];
  const other: string[] = [];
  for (const match of text.matchAll(/(?:^|[\s(`"'=:])(\/[^\s`"'()<>]+)/gmu)) {
    const raw = match[1] ?? "";
    const path = raw.replace(/[.,;:!?]+$/u, "");
    if (path.length < 2) continue;
    const before = text.slice(Math.max(0, (match.index ?? 0) - 16), match.index ?? 0);
    (/\b(?:repo|repository|project|checkout)\s*:?\s*$/iu.test(before) ? labelled : other).push(path);
  }
  return [...new Set([...labelled, ...other])];
}

/** The branch of a ticket's worktree: `ticket/<title-slug>-<short id>`, a valid git branch name. */
export function ticketBranchName(title: string, taskId: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40)
    .replace(/-+$/u, "");
  const id = worktreeName(taskId).slice(-6);
  return `ticket/${slug.length > 0 ? `${slug}-` : ""}${id}`;
}

/** The longest changed-files summary that a side chat reads. */
const CHANGED_FILES_CHARACTERS = 8_000;

/**
 * The files that a worktree changed, for the read-only snapshot of a side chat: `git diff --stat`
 * against `HEAD` and the new files that git does not ignore. Null when git cannot read the folder.
 * It only reads, so it never changes the work thread.
 */
export const worktreeChangedFiles = Effect.fn("AgentWorktrees.changedFiles")(function* (worktreePath: string) {
  const result = yield* Effect.result(
    worktreeIo(async () => {
      const [stat, untracked] = await Promise.all([
        git(worktreePath, ["diff", "--stat", "HEAD"]),
        git(worktreePath, ["ls-files", "--others", "--exclude-standard"]),
      ]);
      const added = untracked
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => ` ${line} (new)`);
      const summary = [stat, ...added].filter((part) => part.length > 0).join("\n");
      return summary.length > CHANGED_FILES_CHARACTERS ? `${summary.slice(0, CHANGED_FILES_CHARACTERS)}\n…` : summary;
    }),
  );
  if (Result.isFailure(result)) {
    logger.info("Could not read the changed files of a work thread.", { error: result.failure.cause });
    return null;
  }
  return result.success;
});

/** Adds the worktree folder to `.git/info/exclude` once. `.gitignore` of the user does not change. */
async function excludeWorktrees(workspacePath: string): Promise<void> {
  const commonDir = await git(workspacePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const excludePath = join(commonDir, "info", "exclude");
  const current = await readFile(excludePath, "utf8").catch(() => "");
  if (current.split(/\r?\n/).includes(EXCLUDE_LINE)) return;
  await mkdir(join(commonDir, "info"), { recursive: true });
  await appendFile(excludePath, `${current.length > 0 && !current.endsWith("\n") ? "\n" : ""}${EXCLUDE_LINE}\n`);
}
