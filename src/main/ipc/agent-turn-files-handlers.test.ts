// @vitest-environment node

import type { ConversationSnapshot, TurnFileDiffResult, TurnFilesResult } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { HostService } from "../host-service";
import { RemoteWorkflowError } from "../remote-service-effects";
import { agentTurnFilesIpcHandlers } from "./agent-turn-files-handlers";

// Same reason as define-ipc-group.test.ts: electron cannot be imported outside an Electron process, so
// registrations are captured.
const { registrations } = vi.hoisted(() => ({
  registrations: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown) {
      registrations.set(channel, listener);
    },
  },
}));

const MAIN_ID = 1;
const CHAT_WINDOW_ID = 2;

const SNAPSHOT: ConversationSnapshot = {
  agentId: "agent-1",
  threadId: "thread-1",
  activeTurnId: null,
  revision: 3,
  messages: [
    {
      id: "turn-1:answer",
      turnId: "turn-1",
      author: "assistant",
      text: "Done.",
      createdAt: "2026-10-30T10:00:05.000Z",
      status: "completed",
      trace: {
        startedAt: "2026-10-30T10:00:00.000Z",
        endedAt: "2026-10-30T10:00:05.000Z",
        steps: [
          {
            id: "item-1",
            kind: "tool",
            text: "Making the requested changes…",
            startedAt: "2026-10-30T10:00:01.000Z",
            endedAt: "2026-10-30T10:00:04.000Z",
            files: [{ path: "/workspace/notes.md", status: "modified", additions: 2, deletions: 1 }],
          },
        ],
      },
    },
  ],
};

function event(senderId: number, url = "openbot-app://app/index.html") {
  return { senderFrame: { url }, sender: { id: senderId } };
}

function register() {
  registrations.clear();
  const fail = (reason: string) => Effect.fail(new RemoteWorkflowError({ cause: new Error(reason) }));
  const listTurnFiles: HostService["listTurnFiles"] = vi.fn((agentId: string, turnId?: string) => {
    if (agentId !== "agent-1") return fail("unknown agent");
    const files: TurnFilesResult["files"] =
      turnId === undefined
        ? [{ path: "/workspace/notes.md", status: "modified" }]
        : [{ path: "/workspace/notes.md", status: "modified", additions: 2, deletions: 1 }];
    return Effect.succeed({ agentId, threadId: "thread-1", turnId: turnId ?? null, files });
  });
  const readTurnFileDiff: HostService["readTurnFileDiff"] = vi.fn((agentId: string, path: string) => {
    if (agentId !== "agent-1" || path === "/etc/passwd") return fail("outside the agent workspace");
    return Effect.succeed({
      path,
      diff: "--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-old\n+new\n",
    });
  });
  const { agentTurnFiles: handlers } = agentTurnFilesIpcHandlers({
    host: { listTurnFiles, readTurnFileDiff },
    mainRendererIds: () => new Set([MAIN_ID]),
  });
  for (const [name, bind] of Object.entries(handlers)) bind(`agent:${name}`);
  const call = (channel: string, senderId: number, payload: unknown, url?: string) => {
    const listener = registrations.get(channel);
    if (!listener) throw new Error(`No handler for ${channel}.`);
    return listener(event(senderId, url), payload);
  };
  return { listTurnFiles, readTurnFileDiff, call };
}

describe("turn files handlers", () => {
  it("lists the files of a turn from the main window", async () => {
    const { call } = register();
    const result = (await call("agent:listTurnFiles", MAIN_ID, {
      agentId: "agent-1",
      turnId: "turn-1",
    })) as TurnFilesResult;
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ path: "/workspace/notes.md", status: "modified" });
  });

  it("reads the diff of a workspace file from the main window", async () => {
    const { call } = register();
    const result = (await call("agent:readTurnFileDiff", MAIN_ID, {
      agentId: "agent-1",
      path: "/workspace/notes.md",
    })) as TurnFileDiffResult;
    expect(result.diff).toContain("+++ b/notes.md");
  });

  it("rejects a chat window sender", () => {
    const { call } = register();
    expect(() => call("agent:listTurnFiles", CHAT_WINDOW_ID, { agentId: "agent-1" })).toThrow(
      "outside the main renderer",
    );
    expect(() =>
      call("agent:readTurnFileDiff", CHAT_WINDOW_ID, { agentId: "agent-1", path: "/workspace/notes.md" }),
    ).toThrow("outside the main renderer");
  });

  it("rejects a file list payload with no agent", () => {
    const { call } = register();
    expect(() => call("agent:listTurnFiles", MAIN_ID, { turnId: "turn-1" })).toThrow();
  });

  it("rejects a diff payload with a path longer than a path", () => {
    const { call } = register();
    expect(() =>
      call("agent:readTurnFileDiff", MAIN_ID, { agentId: "agent-1", path: `/${"x".repeat(5000)}` }),
    ).toThrow();
  });

  it("refuses a file outside the workspace", async () => {
    const { call } = register();
    await expect(
      call("agent:readTurnFileDiff", MAIN_ID, { agentId: "agent-1", path: "/etc/passwd" }),
    ).rejects.toThrow(/outside the agent workspace/);
  });

  it("keeps the stored trace shape the list endpoint reads", () => {
    expect(SNAPSHOT.messages[0]?.trace?.steps[0]?.files?.[0]?.path).toBe("/workspace/notes.md");
  });
});
