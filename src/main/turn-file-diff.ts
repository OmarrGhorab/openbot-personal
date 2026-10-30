import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  INPUT_LIMITS,
  type ConversationSnapshot,
  type TurnChangedFile,
  type TurnFileDiffResult,
  type TurnFilesResult,
} from "@openbot/contracts/ipc";

/**
 * The files of one turn (or of the whole thread when no turn is named) from the steps the host
 * stored on its trace, in the order the steps changed them. A path shows once: the first step
 * that changed it names it.
 */
export function collectTurnFiles(
  agentId: string,
  snapshot: ConversationSnapshot,
  turnId?: string,
): TurnFilesResult {
  const files: TurnChangedFile[] = [];
  const seen = new Set<string>();
  for (const message of snapshot.messages) {
    if (turnId !== undefined && message.turnId !== turnId) continue;
    for (const step of message.trace?.steps ?? []) {
      if (step.kind !== "tool") continue;
      for (const file of step.files ?? []) {
        if (seen.has(file.path)) continue;
        seen.add(file.path);
        files.push({
          path: file.path,
          status: file.status,
          ...(file.additions === undefined ? {} : { additions: file.additions }),
          ...(file.deletions === undefined ? {} : { deletions: file.deletions }),
        });
        if (files.length >= INPUT_LIMITS.turnStepFiles)
          return { agentId, threadId: snapshot.threadId, turnId: turnId ?? null, files };
      }
    }
  }
  return { agentId, threadId: snapshot.threadId, turnId: turnId ?? null, files };
}

/** The git checkout that holds a file, walking up from its folder, or null outside one. */
async function gitRootOf(path: string, run: typeof execFile = execFile): Promise<string | null> {
  const root = await new Promise<string | null>((done) => {
    run("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(path), timeout: 10_000 }, (error, stdout) => {
      if (error) return done(null);
      done(stdout.trim() || null);
    });
  });
  return root;
}

function runGitDiff(root: string, path: string, run: typeof execFile): Promise<string> {
  return new Promise((done) => {
    run(
      "git",
      ["diff", "--no-color", "--no-ext-diff", "--", relative(root, path)],
      { cwd: root, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => done(error ? "" : stdout),
    );
  });
}

/**
 * The working-tree diff and the current text of an already resolved workspace file. A file
 * outside a git checkout, or one git cannot read, keeps an empty diff and still shows its text.
 * Either side is cut to the message bound, so a large file cannot flood the window.
 */
export async function readWorkspaceFileDiff(
  path: string,
  run: typeof execFile = execFile,
): Promise<TurnFileDiffResult> {
  const absolute = resolve(path);
  const root = await gitRootOf(absolute, run);
  const diff = root ? await runGitDiff(root, absolute, run) : "";
  let content: string | undefined;
  try {
    content = (await readFile(absolute, "utf8")).slice(0, INPUT_LIMITS.messageText);
  } catch {
    content = undefined;
  }
  return { path, diff: diff.slice(0, INPUT_LIMITS.messageText), ...(content === undefined ? {} : { content }) };
}
