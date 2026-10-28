import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSummary,
  CONVERSATION_PLAN_ITEM_TYPE,
  type ConversationMessage,
  parseAskSideQuestion,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { worktreeChangedFiles } from "../agent-tasks/agent-worktrees";
import { latestPlanText, sideQuestionPrompt } from "./side-question";

const agent: AgentSummary = {
  id: "agent-1",
  name: "Ada",
  title: "",
  description: "",
  notifications: true,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  threadId: "main-thread",
  workspacePath: "/tmp/agent-1",
  preview: "",
  updatedAt: null,
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};

function message(id: string, text: string, itemType?: string): ConversationMessage {
  return {
    id,
    author: "assistant",
    text,
    createdAt: "2026-10-28T08:00:00.000Z",
    status: "completed",
    ...(itemType ? { itemType } : {}),
  };
}

describe("side chat about a work thread", () => {
  it("reads the newest plan of the thread", () => {
    const messages = [
      message("1", "- [ ] Old step", CONVERSATION_PLAN_ITEM_TYPE),
      message("2", "Working on it."),
      message("3", "- [x] Read the code\n- [ ] Fix the bug", CONVERSATION_PLAN_ITEM_TYPE),
    ];
    expect(latestPlanText(messages)).toBe("- [x] Read the code\n- [ ] Fix the bug");
    expect(latestPlanText([message("1", "No plan here.")])).toBeNull();
  });

  it("puts the task, its plan and its changed files in the prompt", () => {
    const prompt = sideQuestionPrompt(
      agent,
      [message("1", "I changed the login form."), message("2", "- [ ] Run the tests", CONVERSATION_PLAN_ITEM_TYPE)],
      { agentId: "agent-1", question: "What did you change?", earlier: [], taskId: "task-1" },
      { title: "Fix login", changedFiles: " src/login.ts | 4 ++--" },
    );
    expect(prompt).toContain("<task>");
    expect(prompt).toContain("Fix login");
    expect(prompt).toContain("- [ ] Run the tests");
    expect(prompt).toContain("src/login.ts | 4 ++--");
    expect(prompt).toContain("I changed the login form.");
  });

  it("keeps the released prompt for the main chat", () => {
    const prompt = sideQuestionPrompt(agent, [message("1", "Hello.")], {
      agentId: "agent-1",
      question: "What is this?",
      earlier: [],
    });
    expect(prompt).not.toContain("<task>");
    expect(prompt).toContain("about your chat with them");
  });

  it("parses an optional task id", () => {
    expect(parseAskSideQuestion({ agentId: "agent-1", question: "Why?", earlier: [], taskId: "task-1" }).taskId).toBe(
      "task-1",
    );
    expect(parseAskSideQuestion({ agentId: "agent-1", question: "Why?", earlier: [] })).not.toHaveProperty("taskId");
    expect(() => parseAskSideQuestion({ agentId: "agent-1", question: "Why?", earlier: [], taskId: 3 })).toThrow();
  });
});

describe("worktreeChangedFiles", () => {
  let root: string | null = null;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  it("lists the changed and the new files of a worktree", async () => {
    root = mkdtempSync(join(tmpdir(), "openbot-side-chat-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", root ?? "", ...args], { stdio: "pipe" });
    git("init", "-q");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "start");
    writeFileSync(join(root, "tracked.txt"), "one\n");
    git("add", "tracked.txt");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "add");
    writeFileSync(join(root, "tracked.txt"), "two\n");
    writeFileSync(join(root, "new.txt"), "new\n");
    const summary = await Effect.runPromise(worktreeChangedFiles(root));
    expect(summary).toContain("tracked.txt");
    expect(summary).toContain("new.txt (new)");
  });

  it("gives null for a folder that git cannot read", async () => {
    root = mkdtempSync(join(tmpdir(), "openbot-side-chat-"));
    expect(await Effect.runPromise(worktreeChangedFiles(join(root, "missing")))).toBeNull();
  });
});
