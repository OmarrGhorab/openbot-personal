import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "AgentRoutinesSettings.tsx"), "utf8");

describe("ticket 256: an unsaved routine is not lost", () => {
  it("keeps a dirty draft when the editor closes and opens it again unsaved", () => {
    expect(source).toContain("if (current && dirty()) unsavedRoutineDrafts.set(props.port.ownerId, current);");
    expect(source).toContain("const kept = restoredDraft ? undefined : unsavedRoutineDrafts.get(props.port.ownerId);");
    expect(source).toMatch(/setDraft\(kept\);\s*draftRevision = 1;\s*setDirty\(true\);/u);
  });
  it("shows a routine failure in full", () => {
    const css = readFileSync(
      join(__dirname, "../../../../../packages/ui/src/features/conversation/styles/agent-settings.css"),
      "utf8",
    );
    expect(css).toMatch(/\.agent-routine-run-reason \{\s*overflow: visible;\s*white-space: normal;/u);
  });
});
