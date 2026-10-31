import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { changedByTurn, findStoredFileDiff, readWorkspaceFileDiff } from "./turn-file-diff";

function conversation(path: string, diff?: string): ConversationSnapshot {
  const snapshot = {
    threadId: "thread-1",
    messages: [{ turnId: "t1", trace: { steps: [{ kind: "tool", files: [{ path, status: "modified", diff }] }] } }],
  };
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: A test snapshot carries only the fields the reader uses.
  return snapshot as unknown as ConversationSnapshot;
}

describe("ticket 254: a changed file outside the agent workspace", () => {
  it("is allowed only when a turn changed it", () => {
    const snapshot = conversation("/workspace/obp-factory/math.js");
    expect(changedByTurn("a", snapshot, "/workspace/obp-factory/math.js")).toBe(true);
    expect(changedByTurn("a", snapshot, "/etc/passwd")).toBe(false);
  });

  it("reads its git diff from the repository that holds it", async () => {
    const root = mkdtempSync(join(tmpdir(), "outside-diff-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    const file = join(root, "math.js");
    writeFileSync(file, "export const add = (a, b) => a - b;\n");
    git("add", ".");
    git("commit", "-qm", "init");
    writeFileSync(file, "export const add = (a, b) => a + b;\n");
    const result = await readWorkspaceFileDiff(file);
    expect(result.diff).toContain("+export const add = (a, b) => a + b;");
  });

  it("prefers the diff the turn stored", () => {
    expect(findStoredFileDiff(conversation("/x/a.js", "@@ -1 +1 @@"), "/x/a.js")).toBe("@@ -1 +1 @@");
  });
});
