import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AGENT_DONE_CHECK_LIMITS,
  type AgentSummary,
  DONE_CHECK_FAILED_ITEM_TYPE,
  DONE_CHECK_PASSED_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import { z } from "zod";
import type { AgentStore } from "../agent-store";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import { causeHelpers } from "../effect-boundary";
import type { DynamicToolCallParams } from "../protocol";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";

const logger = createOpenBotLogger("agent-done-checks");

export const MARK_DONE_TOOL = "mark_done";

export const markDoneToolSchema = z.strictObject({
  reviewRound: z.number().int().min(1).max(AGENT_DONE_CHECK_LIMITS.reviewRounds).optional(),
});

/** One check of the definition of done may run this long before it is stopped. */
const CHECK_TIMEOUT_MS = 10 * 60_000;
/** The last characters of a check's output that the agent and the chat read. */
const OUTPUT_TAIL_CHARACTERS = 4_000;
/** Output of one check beyond this size is cut by Node, and the check then reports a failure. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const execFileAsync = promisify(execFile);

class DoneCheckIoFailed extends Schema.TaggedError<DoneCheckIoFailed>()("DoneCheckIoFailed", {
  cause: Schema.Defect(),
}) {}

const { io: checkIo } = causeHelpers(DoneCheckIoFailed);

/** One check of a definition of done, after it ran. The text is redacted and cut to its tail. */
interface DoneCheckRun {
  command: string;
  status: "passed" | "failed";
  /** Null when the check did not exit, such as a timeout or a program that could not start. */
  exitCode: number | null;
  output: string;
}

interface AgentDoneChecksOptions {
  /** The agents, for their checks, workspace and reviewer. */
  store: Pick<AgentStore, "list">;
  /** The task of a thread, and the worktree of a task. */
  tasks: Pick<AgentTasks, "taskForThread" | "workspace">;
  /** Adds the note of the checks to the thread where the tool was called. */
  postCard(agentId: string, threadId: string, turnId: string, card: DoneCheckCard): void;
}

export interface DoneCheckCard {
  itemType: string;
  text: string;
  eventType: string;
  detail: { passed: boolean; checks: number };
}

/**
 * `openbot.mark_done`: an agent proves its work before it reports it done.
 *
 * The tool runs the agent's definition of done, one command after the other, in the agent workspace
 * or in the git worktree of its task. It stops at the first failing command, posts the result in the
 * thread, and tells the agent to fix the failure and call it again. With a reviewer, a passing run
 * asks the agent to send the diff to the reviewer first, and round by round until the review ends.
 *
 * The commands are set by the user only; no agent tool changes them. Output is redacted before it
 * reaches the thread or the agent.
 *
 * It never imports the agent service facade.
 */
export class AgentDoneChecks {
  readonly #store: AgentDoneChecksOptions["store"];
  readonly #tasks: AgentDoneChecksOptions["tasks"];
  readonly #postCard: AgentDoneChecksOptions["postCard"];

  constructor(options: AgentDoneChecksOptions) {
    this.#store = options.store;
    this.#tasks = options.tasks;
    this.#postCard = options.postCard;
  }

  /** Answers `mark_done`; null for every other tool. */
  readonly handleTool = Effect.fn("AgentDoneChecks.handleTool")(function* (
    this: AgentDoneChecks,
    params: DynamicToolCallParams,
    agentId: string,
    threadId: string,
  ): Effect.fn.Return<OpenBotToolResponse | null> {
    if (params.tool !== MARK_DONE_TOOL) return null;
    const parsed = markDoneToolSchema.safeParse(params.arguments ?? {});
    if (!parsed.success) return openBotToolFailure(sourceText("error.backend.markDoneInvalid"));
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return openBotToolFailure(sourceText("error.backend.markDoneNoAgent"));

    const commands = agent.definitionOfDone ?? [];
    const cwd = this.#workspace(agent, threadId);
    const runs: DoneCheckRun[] = [];
    for (const command of commands) {
      const run = yield* runCheck(command, cwd);
      runs.push(run);
      if (run.status === "failed") break;
    }
    const failed = runs.find((run) => run.status === "failed");
    const reviewer = this.#reviewer(agent);
    if (commands.length > 0) {
      this.#postCard(agentId, threadId, params.turnId, checkCard(runs, commands.length, failed));
      logger.info("Ran the definition of done.", { agentId, checks: commands.length, passed: failed === undefined });
    }
    return openBotToolResult(
      resultFor({
        commands: commands.length,
        runs,
        failed,
        reviewer,
        reviewRound: parsed.data.reviewRound ?? null,
      }),
    );
  });

  /** The folder the checks run in: the task worktree when the call comes from a task, or the agent workspace. */
  #workspace(agent: AgentSummary, threadId: string): string {
    const taskId = this.#tasks.taskForThread(threadId);
    if (taskId) {
      const workspace = this.#tasks.workspace(taskId, agent.id);
      if (workspace.mode === "worktree") return workspace.path;
    }
    return agent.workspacePath;
  }

  /** The reviewer that still exists on this computer, or null when none is set or it was removed. */
  #reviewer(agent: AgentSummary): { id: string; name: string } | null {
    if (!agent.reviewerAgentId) return null;
    const reviewer = this.#store.list().find((candidate) => candidate.id === agent.reviewerAgentId);
    return reviewer ? { id: reviewer.id, name: reviewer.name } : null;
  }
}

/** Runs one command in the folder, through the shell of this computer. Output is redacted and cut to its tail. */
const runCheck = Effect.fn("AgentDoneChecks.runCheck")(function* (
  command: string,
  cwd: string,
): Effect.fn.Return<DoneCheckRun> {
  const result = yield* Effect.result(checkIo((signal) => runShellCommand(command, cwd, signal)));
  if (Result.isFailure(result)) {
    return {
      command: redactText(command),
      status: "failed",
      exitCode: null,
      output: redactText("The check could not start."),
    };
  }
  return { command: redactText(command), ...result.success };
});

async function runShellCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
): Promise<Pick<DoneCheckRun, "status" | "exitCode" | "output">> {
  const [file, args] =
    process.platform === "win32"
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command]]
      : ["/bin/sh", ["-c", command]];
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      signal,
    });
    return { status: "passed", exitCode: 0, output: tail(redactText(`${stdout}${stderr}`)) };
  } catch (error) {
    return failedRun(error);
  }
}

/** A check that did not exit cleanly: its exit code (null when it did not exit), and its redacted output. */
function failedRun(error: unknown): Pick<DoneCheckRun, "status" | "exitCode" | "output"> {
  if (!(error instanceof Error)) return { status: "failed", exitCode: null, output: "" };
  const code = "code" in error ? error.code : undefined;
  const stdout = "stdout" in error ? error.stdout : undefined;
  const stderr = "stderr" in error ? error.stderr : undefined;
  const output = [stdout, stderr].filter((part): part is string => typeof part === "string").join("");
  const detail = output.length > 0 ? output : error.message;
  return { status: "failed", exitCode: typeof code === "number" ? code : null, output: tail(redactText(detail)) };
}

function tail(text: string, characters = OUTPUT_TAIL_CHARACTERS): string {
  return text.length > characters ? `…${text.slice(text.length - characters)}` : text;
}

function checkCard(runs: readonly DoneCheckRun[], total: number, failed: DoneCheckRun | undefined): DoneCheckCard {
  if (!failed) {
    return {
      itemType: DONE_CHECK_PASSED_ITEM_TYPE,
      text: sourceText("status.agent.doneChecksPassed", { count: total }),
      eventType: "done.checks_passed",
      detail: { passed: true, checks: total },
    };
  }
  const text =
    failed.exitCode === null
      ? sourceText("status.agent.doneCheckStopped", { command: failed.command })
      : sourceText("status.agent.doneCheckFailed", { command: failed.command, exitCode: failed.exitCode });
  // The headline only: the renderer translates a headline it knows, and the agent reads the output.
  return {
    itemType: DONE_CHECK_FAILED_ITEM_TYPE,
    text,
    eventType: "done.checks_failed",
    detail: { passed: false, checks: runs.length },
  };
}

interface ResultInput {
  commands: number;
  runs: readonly DoneCheckRun[];
  failed: DoneCheckRun | undefined;
  reviewer: { id: string; name: string } | null;
  reviewRound: number | null;
}

/** The JSON that the agent reads. The notes are prompt text for the agent, so they stay in English. */
function resultFor(input: ResultInput) {
  const checks = input.runs.map((run) => ({
    command: run.command,
    status: run.status,
    exitCode: run.exitCode,
    ...(run.status === "failed" ? { output: run.output } : {}),
  }));
  const review = input.reviewer
    ? {
        reviewerAgentId: input.reviewer.id,
        reviewerName: input.reviewer.name,
        round: input.reviewRound,
        maxRounds: AGENT_DONE_CHECK_LIMITS.reviewRounds,
      }
    : null;
  if (input.failed) {
    return {
      status: "blocked",
      checks,
      review,
      note: "A check failed, so the work is not done. Fix the cause in your workspace, run the failing command yourself, and call openbot.mark_done again. Do not report the work as done until every check passes. If you cannot fix it after three attempts, tell the user what failed and why.",
    };
  }
  if (input.reviewer && input.reviewRound === null) {
    return {
      status: "review_required",
      checks,
      review,
      note: `Every check passed. Before the work is done, send the diff of this change to ${input.reviewer.name} with openbot.send_message: set recipientAgentIds to ["${input.reviewer.id}"], expectsReply to true, and a brief with the goal, the changed files, and the check results. Then end your turn; the findings arrive in a later turn. Fix every high and medium finding, and reply to the others. Then call openbot.mark_done with reviewRound set to the round you are in, from 1 to ${AGENT_DONE_CHECK_LIMITS.reviewRounds}.`,
    };
  }
  if (input.reviewer) {
    const last = input.reviewRound === AGENT_DONE_CHECK_LIMITS.reviewRounds;
    return {
      status: "done",
      checks,
      review,
      note: `Every check passed and review round ${input.reviewRound} of ${AGENT_DONE_CHECK_LIMITS.reviewRounds} is recorded. ${last ? "This was the last review round: report any finding that is still open to the user, and do not start another round." : "If the reviewer found open issues, send the next round as described before you report the work as done."}`,
    };
  }
  return {
    status: "done",
    checks,
    review,
    note:
      input.commands === 0
        ? "No checks are set for you. Say in your answer that the user has not set a definition of done, and that no check ran."
        : "Every check passed. You may report the work as done, and name the checks that passed.",
  };
}
