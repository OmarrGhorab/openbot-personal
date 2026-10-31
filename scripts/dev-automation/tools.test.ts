import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNth, pickRoleMatch, resolveScreenshotPath } from "./tools";

describe("pickRoleMatch", () => {
  it("says no match instead of timing out", () => {
    expect(() => pickRoleMatch(0, "button", "Providers", null)).toThrow('No match for role=button name="Providers".');
  });

  it("names the count for many matches and picks one with --nth", () => {
    expect(() => pickRoleMatch(2, "button", "New ticket", null)).toThrow(
      '2 matches for role=button name="New ticket". Pass --nth=<1..2> or --exact.',
    );
    expect(pickRoleMatch(2, "button", "New ticket", 2)).toBe(1);
    expect(pickRoleMatch(1, "button", "New ticket", null)).toBe(0);
    expect(() => pickRoleMatch(2, "button", "New ticket", 3)).toThrow("--nth=3 is out of range");
  });

  it("parses --nth", () => {
    expect(parseNth(null)).toBeNull();
    expect(parseNth("2")).toBe(2);
    expect(() => parseNth("0")).toThrow();
  });
});

describe("resolveScreenshotPath", () => {
  const workspace = resolve("/tmp/obp-ws");
  const root = join(workspace, ".openbot-build", "dev-automation");

  it("keeps a worktree-relative path inside the root flat", () => {
    expect(resolveScreenshotPath(root, ".openbot-build/dev-automation/a.png", 1, workspace)).toBe(join(root, "a.png"));
  });

  it("resolves a bare name inside the root", () => {
    expect(resolveScreenshotPath(root, "b.png", 1, workspace)).toBe(join(root, "b.png"));
    expect(resolveScreenshotPath(root, null, 7, workspace)).toBe(join(root, "screenshot-7.png"));
  });
});
