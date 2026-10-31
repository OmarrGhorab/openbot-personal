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

/** The longest work folder path that an agent or a ticket keeps (#257). */
export const WORK_FOLDER_LIMIT = 4_096;

/**
 * A work folder (#257): the repository or folder where the agent's turns and the ticket's work run. An
 * absolute path, on this computer. `/` and a Windows drive letter both count as absolute.
 */
export function isWorkFolder(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= WORK_FOLDER_LIMIT &&
    value.trim() === value &&
    !value.includes("\0") &&
    (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value))
  );
}
