import type { RavenTeamJob, RavenTeamRoleRun } from "@openbot/contracts/ipc";

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
