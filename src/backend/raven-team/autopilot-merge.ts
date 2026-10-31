import {
  type BoardTicketReviewVerdict,
  boardTicketMayMerge,
  type RavenTeamJob,
  type RavenTeamRoleRun,
} from "@openbot/contracts/ipc";

/**
 * The team half of the Reviewer's merge rules (#198). The other half (CI and the pull request head) is read
 * from GitHub just before the merge. A job may merge only when all of these hold:
 *
 * - the job passed: its state is `done` and it has a head commit;
 * - the Reviewer said PASS or PASS+NOTES on that head commit;
 * - Quality, when the team has it, scored 10 on that head commit;
 * - no checking role holds a FAIL.
 *
 * Pure: it reads the job only. A FAIL never merges, and a job that stopped at the round limit is `not-done`.
 */
export interface AutopilotMergeVerdicts {
  commit: string;
  reviewer: "PASS" | "PASS+NOTES";
  /** 10 when Quality is on the team, else null. */
  qualityScore: number | null;
}

function isReviewer(role: RavenTeamRoleRun): boolean {
  return role.roleId === "reviewer";
}

function isQuality(role: RavenTeamRoleRun): boolean {
  return role.roleId === "quality";
}

/** The verdicts that allow a merge of the job's head commit, or null when the team rules do not hold. */
export function autopilotMergeVerdicts(
  job: Pick<RavenTeamJob, "state" | "headCommit" | "roles">,
): AutopilotMergeVerdicts | null {
  const head = job.headCommit;
  if (job.state !== "done" || head === null) return null;
  if (job.roles.some((role) => role.verdict === "FAIL")) return null;
  const reviewer = job.roles.find(isReviewer);
  if (!reviewer || reviewer.commit !== head) return null;
  if (reviewer.verdict !== "PASS" && reviewer.verdict !== "PASS+NOTES") return null;
  const quality = job.roles.find(isQuality);
  if (quality && (quality.commit !== head || quality.score !== 10)) return null;
  return { commit: head, reviewer: reviewer.verdict, qualityScore: quality ? 10 : null };
}

/**
 * Ticket 239: the merge rule of a single ticket thread, with no team. Its reviewer's verdicts are saved on
 * the ticket: the newest one on the current head is PASS or PASS+NOTES, and no FAIL was given on that head.
 * A verdict on an older commit never counts.
 */
export function ticketThreadMergeVerdicts(
  verdicts: readonly BoardTicketReviewVerdict[],
  head: string | null,
): AutopilotMergeVerdicts | null {
  if (!head || !boardTicketMayMerge(verdicts, head)) return null;
  const last = verdicts.filter((verdict) => verdict.headSha === head).at(-1);
  if (!last || last.verdict === "FAIL") return null;
  return { commit: head, reviewer: last.verdict, qualityScore: null };
}
