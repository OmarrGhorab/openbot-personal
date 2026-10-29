import { isIdentifier } from "./ipc-bounded-values";

/**
 * The limits of an agent's definition of done: the commands that must pass before its work counts
 * as done, and the review rounds that its reviewer may run.
 */
export const AGENT_DONE_CHECK_LIMITS = {
  /** Commands in one definition of done. */
  commands: 8,
  /** Characters in one command. A command is one line. */
  commandLength: 500,
  /** Review rounds of one change: a `mark_done` call names a round from 1 to this. */
  reviewRounds: 3,
} as const;

/**
 * Whether a value is a definition of done: at most `AGENT_DONE_CHECK_LIMITS.commands` commands, each
 * a non-empty single line within `commandLength`. Commands are run by the computer that runs the
 * agent, in its workspace, so the check stays strict.
 */
export function isAgentDefinitionOfDone(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= AGENT_DONE_CHECK_LIMITS.commands &&
    value.every(
      (command) =>
        typeof command === "string" &&
        command.trim().length > 0 &&
        command.trim().length <= AGENT_DONE_CHECK_LIMITS.commandLength &&
        !/[\r\n]/.test(command),
    )
  );
}

/** Whether a value names an agent that may review another agent's change. */
export function isAgentReviewerAgentId(value: unknown): value is string {
  return isIdentifier(value);
}
