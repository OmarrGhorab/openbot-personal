// The scheduled coding jobs that an agent on this computer can start with one click. Each job's
// instruction is the body of its Markdown skill in `resources/autonomy-skills`, so the routine and
// the skill text stay one file. The instruction is agent input in English; the name and summary the
// user reads come from the catalogs.

import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import cleanTodosSkill from "../../../../../resources/autonomy-skills/clean-todos/SKILL.md?raw";
import triageFlakyTestsSkill from "../../../../../resources/autonomy-skills/triage-flaky-tests/SKILL.md?raw";
import triageStaleIssuesSkill from "../../../../../resources/autonomy-skills/triage-stale-issues/SKILL.md?raw";
import updateDependenciesSkill from "../../../../../resources/autonomy-skills/update-dependencies/SKILL.md?raw";

export interface RoutineTemplate {
  id: string;
  nameKey: AppTextKey;
  summaryKey: AppTextKey;
  /** Weekly and monthly only: a job that opens pull requests or closes issues must not run every few minutes. */
  schedule: RoutineSchedule;
  instruction: string;
}

/** The skill body without its front matter. */
function routineTemplateInstruction(skillMarkdown: string): string {
  return skillMarkdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "").trim();
}

// Weekdays count from Sunday as 0, as `getUTCDay` does.
const MONDAY = 1;
const TUESDAY = 2;
const FRIDAY = 5;

export const ROUTINE_TEMPLATES: readonly RoutineTemplate[] = [
  {
    id: "update-dependencies",
    nameKey: "routine.template.updateDependencies.name",
    summaryKey: "routine.template.updateDependencies.summary",
    schedule: { kind: "weekly", weekday: MONDAY, time: "09:00" },
    instruction: routineTemplateInstruction(updateDependenciesSkill),
  },
  {
    id: "triage-flaky-tests",
    nameKey: "routine.template.triageFlakyTests.name",
    summaryKey: "routine.template.triageFlakyTests.summary",
    schedule: { kind: "weekly", weekday: TUESDAY, time: "09:00" },
    instruction: routineTemplateInstruction(triageFlakyTestsSkill),
  },
  {
    id: "clean-todos",
    nameKey: "routine.template.cleanTodos.name",
    summaryKey: "routine.template.cleanTodos.summary",
    schedule: { kind: "monthly", day: 1, time: "09:00" },
    instruction: routineTemplateInstruction(cleanTodosSkill),
  },
  {
    id: "triage-stale-issues",
    nameKey: "routine.template.triageStaleIssues.name",
    summaryKey: "routine.template.triageStaleIssues.summary",
    schedule: { kind: "weekly", weekday: FRIDAY, time: "09:00" },
    instruction: routineTemplateInstruction(triageStaleIssuesSkill),
  },
];
