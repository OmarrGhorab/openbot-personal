import { RAVEN_TEAM_REPORT_PREFIX, type RavenTeamRoleAccess, ravenPstackSkill } from "@openbot/contracts/ipc";

/** The most text one handoff carries. A longer report is cut, and the cut is marked. */
const HANDOFF_CHARACTERS = 12_000;

/** The report line of each built-in role. A role that is not listed reports `DONE`. */
const REPORT_LINES: Record<string, string> = {
  architect: '{"verdict":"DONE"}',
  builder: '{"verdict":"DONE","commit":"<full head commit>","pr":"<pull request URL>"}',
  reviewer: '{"verdict":"PASS","commit":"<reviewed commit>"}',
  quality: '{"verdict":"PASS","score":10,"commit":"<reviewed commit>"}',
  editor: '{"verdict":"DONE"}',
};

/** What each built-in role does. The access line and the skill list come from the template. */
const ROLE_STEPS: Record<string, string> = {
  architect: "Read the ticket. Write the plan. Your final message is the plan that the Builder receives.",
  builder:
    "You are the only writer of the branch. Use a git worktree and a branch for this job only, named with the job id: other jobs of the team run at the same time and must not share your files. Build the ticket, open the pull request and get CI green. When the Reviewer or Quality sends REVIEW FINDINGS, run the fix round, push a new commit and report it.",
  reviewer:
    "Review the commit that the team names. Verdict only on that commit. If you start a server, use the Builder's dev port plus 5. Change no file.",
  quality: "Score the commit that the team names, out of 10. Use FAIL when the score is below 10. Change no file.",
  editor:
    "Edit text only: the pull request text and the docs it names. Change no code. Report DONE with the new commit.",
};

export interface RoleBriefInput {
  jobId: string;
  roleId: string;
  label: string;
  skills: readonly string[];
  access: RavenTeamRoleAccess;
  ticket: string;
  /**
   * The pstack playbook of the job (#197), such as `tdd`. Set on the Builder of a pstack job only: it
   * follows `$pstack-<playbook>` instead of the Raven Stack build skills. Null or absent otherwise.
   */
  playbook?: string | null;
}

/** The first message of a role's work thread. It names the role, its skills, its access and the report line. */
export function roleBrief(input: RoleBriefInput): string {
  const access =
    input.access === "write"
      ? "write. You are the only role that commits and pushes the branch."
      : "read-only. Do not edit files, commit or push. Only the Builder writes to the branch.";
  const skills = input.skills.map((skill) => `$raven-stack-${skill}`).join(", ");
  const playbook = input.playbook ? `$${ravenPstackSkill(input.playbook)}` : null;
  const skillLines = playbook
    ? [
        `This job runs pstack with one playbook. Follow ${playbook} from start to end; do not chain another playbook.`,
        `If ${playbook} is not installed, change nothing, name the missing skill and end with ${RAVEN_TEAM_REPORT_PREFIX} {"verdict":"BLOCKED"}.`,
      ]
    : [`Run these Raven Stack skills in order: ${skills || "none"}.`];
  return [
    `You are the ${input.label} of a Raven Stack team. Job ${input.jobId}.`,
    `Access: ${access}`,
    ...skillLines,
    ROLE_STEPS[input.roleId] ?? "Do your step of the ticket and report.",
    "Your final message must end with one line, and nothing after it:",
    `${RAVEN_TEAM_REPORT_PREFIX} ${REPORT_LINES[input.roleId] ?? '{"verdict":"DONE"}'}`,
    "",
    "Ticket:",
    input.ticket,
  ].join("\n");
}

/** A text cut to the handoff size. The cut is marked, so the reader knows the text is not complete. */
function clipHandoff(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= HANDOFF_CHARACTERS) return trimmed;
  return `${trimmed.slice(0, HANDOFF_CHARACTERS - 40)}\n[... cut; the full text is in the thread ...]`;
}

/** The Architect's plan, sent to the Builder. */
export function planHandoff(fromLabel: string, text: string): string {
  return [
    `Plan from the ${fromLabel}. Follow it.`,
    "Report with the RAVEN-REPORT line when you are done.",
    "",
    clipHandoff(text),
  ].join("\n");
}

/** A verifier's start on a commit: the head commit and the Builder's report. */
export function commitHandoff(commit: string, builderText: string): string {
  return [
    `Review commit ${commit}. It is the head of the job. Your verdict counts for this commit only.`,
    "End your final message with the RAVEN-REPORT line.",
    "",
    "Builder report:",
    clipHandoff(builderText),
  ].join("\n");
}

/** The findings of a FAIL, sent to the Builder for the fix round. */
export function findingsHandoff(fromLabel: string, commit: string | null, text: string): string {
  return [
    `REVIEW FINDINGS from the ${fromLabel}${commit ? ` on commit ${commit}` : ""}.`,
    "Run the fix round. Push a new commit. Then report it with:",
    `${RAVEN_TEAM_REPORT_PREFIX} {"verdict":"DONE","commit":"<new head commit>"}`,
    "",
    clipHandoff(text),
  ].join("\n");
}

/** A verdict that names a commit which is no longer the head. The role reviews the head instead. */
export function staleCommitNotice(reported: string, head: string): string {
  return [
    `Your report names commit ${reported}, but the head of the job is ${head}.`,
    `Review commit ${head}, then report it with the RAVEN-REPORT line.`,
  ].join("\n");
}

/** The text of the Editor, sent to the Builder as notes on the pull request text. */
export function editorNotesHandoff(text: string): string {
  return [
    "Text notes from the Editor. Apply them to the pull request text only, then report DONE with the new commit.",
    "",
    clipHandoff(text),
  ].join("\n");
}

/** Asked once more when a role's final message has no report line. */
export function reportReminder(roleId: string): string {
  return [
    "Your last message has no RAVEN-REPORT line.",
    `Send your report now, as one line in this form, and do not repeat your work:`,
    `${RAVEN_TEAM_REPORT_PREFIX} ${REPORT_LINES[roleId] ?? '{"verdict":"DONE"}'}`,
  ].join("\n");
}

/** Sent to a role that the user resumed, when it has no pending handoff. */
export function resumeNotice(): string {
  return "The team resumed. Continue your step. End your final message with the RAVEN-REPORT line.";
}
