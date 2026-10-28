import { describe, expect, it } from "vitest";
import { ROUTINE_TEMPLATES, scheduledRoutineTemplateIds } from "./routine-templates";

const template = (id: string) => {
  const found = ROUTINE_TEMPLATES.find((item) => item.id === id);
  if (!found) throw new Error(`No template ${id}.`);
  return found;
};

describe("routine templates", () => {
  it("puts each template id in its instruction, above the skill body without front matter", () => {
    for (const item of ROUTINE_TEMPLATES) {
      expect(item.instruction.startsWith(`<!-- openbot-routine-template: ${item.id} -->\n\n`)).toBe(true);
      expect(item.instruction).not.toContain("\n---\n");
    }
    expect(scheduledRoutineTemplateIds(ROUTINE_TEMPLATES)).toEqual(new Set(ROUTINE_TEMPLATES.map(({ id }) => id)));
  });

  it("finds a template by its id after the routine is renamed or the app language changes", () => {
    const routines = [
      { name: "My dependency bump", instruction: template("update-dependencies").instruction },
      { name: "تحديث الاعتماديات", instruction: template("clean-todos").instruction },
    ];

    expect(scheduledRoutineTemplateIds(routines)).toEqual(new Set(["update-dependencies", "clean-todos"]));
  });

  it("does not count a routine the user wrote with a template's name", () => {
    const routines = [{ name: "Update dependencies", instruction: "Bump the packages and open a pull request." }];

    expect(scheduledRoutineTemplateIds(routines).size).toBe(0);
  });

  it("reads the id only from the first line", () => {
    const quoted = `Check this:\n<!-- openbot-routine-template: triage-flaky-tests -->`;

    expect(scheduledRoutineTemplateIds([{ instruction: quoted }]).size).toBe(0);
    expect(scheduledRoutineTemplateIds([{ instruction: `  ${template("triage-stale-issues").instruction}` }])).toEqual(
      new Set(["triage-stale-issues"]),
    );
  });
});
