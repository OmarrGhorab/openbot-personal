// @vitest-environment node

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { resolveWorkspaceFile } from "./workspace-paths";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * Two agent workspaces under one managed Agents tree, as on the host: the viewer asks from
 * agent-b while the file lives in agent-a's workspace.
 */
async function twoWorkspaces() {
  const root = await mkdtemp(join(tmpdir(), "openbot-workspace-links-"));
  roots.push(root);
  const workspaceA = join(root, "Agents", "agent-a");
  const workspaceB = join(root, "Agents", "agent-b");
  await mkdir(workspaceA, { recursive: true });
  await mkdir(workspaceB, { recursive: true });
  const file = join(workspaceA, "notes.md");
  await writeFile(file, "hello");
  return { file, viewer: { id: "agent-b", workspacePath: workspaceB } };
}

describe("resolveWorkspaceFile across agent workspaces", () => {
  it("opens a file from another agent workspace, even with a :line suffix", async () => {
    const { file, viewer } = await twoWorkspaces();
    for (const input of [file, `${file}:1`]) {
      const resolved = await runCauseEffect(resolveWorkspaceFile(viewer, input, { allowOutside: true }));
      expect(resolved.path).toBe(await realpath(file));
      expect(resolved.insideWorkspace).toBe(false);
      expect(resolved.safeToOpen).toBe(true);
    }
  });

  it("opens a file inside the viewing workspace", async () => {
    const { file } = await twoWorkspaces();
    const owner = { id: "agent-a", workspacePath: join(file, "..") };
    const resolved = await runCauseEffect(resolveWorkspaceFile(owner, file, {}));
    expect(resolved.insideWorkspace).toBe(true);
    expect(resolved.safeToOpen).toBe(true);
  });

  it("only reveals an existing file outside every managed tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-outside-"));
    roots.push(root);
    const outside = join(root, "notes.md");
    await writeFile(outside, "hello");
    const viewer = { id: "agent-b", workspacePath: join(root, "Agents", "agent-b") };
    await mkdir(viewer.workspacePath, { recursive: true });
    const resolved = await runCauseEffect(resolveWorkspaceFile(viewer, outside, { allowOutside: true }));
    expect(resolved.insideWorkspace).toBe(false);
    expect(resolved.safeToOpen).toBe(false);
  });

  it("still refuses an outside file when the agent is restricted", async () => {
    const { file, viewer } = await twoWorkspaces();
    await expect(runCauseEffect(resolveWorkspaceFile(viewer, file, {}))).rejects.toThrow("inside the agent workspace");
  });

  it("still reports a file that exists nowhere as missing", async () => {
    const { viewer } = await twoWorkspaces();
    const missing = join(viewer.workspacePath, "..", "agent-a", "gone.md");
    await expect(runCauseEffect(resolveWorkspaceFile(viewer, missing, { allowOutside: true }))).rejects.toThrow(
      "Nothing exists",
    );
  });
});
