import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "../protocol";
import {
  buildTurnStepEvent,
  classifyTurnStepKind,
  TurnStepFileBudget,
  turnStepFiles,
} from "./turn-step-event";

function item(overrides: Record<string, unknown>): ThreadItem {
  return { type: "toolCall", id: "item-1", ...overrides };
}

const STARTED_AT = "2026-10-30T10:00:00.000Z";

describe("classifyTurnStepKind", () => {
  it("names a shell call a command", () => {
    expect(classifyTurnStepKind(item({ name: "Bash", command: "bun test" }))).toBe("command");
  });

  it("names a file write a file change", () => {
    expect(classifyTurnStepKind(item({ name: "Write", filePath: "/tmp/notes.md" }))).toBe("file-change");
  });

  it("names a subagent call a subagent", () => {
    expect(classifyTurnStepKind(item({ name: "Task", tool: "Task" }))).toBe("subagent");
  });

  it("names an assistant message a thought", () => {
    expect(classifyTurnStepKind({ type: "agentMessage", id: "m-1", text: "Thinking aloud" })).toBe("thought");
  });

  it("skips a file read, which the progress line already covers", () => {
    expect(classifyTurnStepKind(item({ name: "Read", filePath: "/tmp/notes.md" }))).toBeNull();
  });
});

describe("buildTurnStepEvent", () => {
  it("redacts a token in the command", () => {
    const event = buildTurnStepEvent({
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      item: item({ name: "Bash", command: "deploy --token sk-ant-secret-token-value-123" }),
      text: "Running the deploy…",
      completed: false,
      startedAt: STARTED_AT,
      endedAt: null,
      files: [],
    });
    expect(event?.type).toBe("turn-step");
    if (event?.type !== "turn-step") return;
    expect(event.kind).toBe("command");
    expect(event.status).toBe("running");
    expect(event.command).not.toContain("sk-ant-secret-token-value-123");
    expect(event.command).toContain("[redacted]");
  });

  it("marks a failed exit code as failed", () => {
    const event = buildTurnStepEvent({
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      item: item({ name: "Bash", command: "bun test", status: "completed", exitCode: 1 }),
      text: "Checking the work…",
      completed: true,
      startedAt: STARTED_AT,
      endedAt: "2026-10-30T10:00:01.000Z",
      files: [],
    });
    if (event?.type !== "turn-step") throw new Error("Expected a turn-step event.");
    expect(event.status).toBe("failed");
    expect(event.exitCode).toBe(1);
  });

  it("carries the files of a file change", () => {
    const event = buildTurnStepEvent({
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      item: item({ name: "Write", filePaths: ["/tmp/a.md", "/tmp/b.md"] }),
      text: "Making the requested changes…",
      completed: true,
      startedAt: STARTED_AT,
      endedAt: "2026-10-30T10:00:01.000Z",
      files: turnStepFiles(item({ name: "Write", filePaths: ["/tmp/a.md", "/tmp/b.md"] })),
    });
    if (event?.type !== "turn-step") throw new Error("Expected a turn-step event.");
    expect(event.files?.map((file) => file.path)).toEqual(["/tmp/a.md", "/tmp/b.md"]);
  });
});

describe("TurnStepFileBudget", () => {
  it("caps the files of one turn", () => {
    const budget = new TurnStepFileBudget();
    const files = Array.from({ length: INPUT_LIMITS.turnStepFiles + 5 }, (_, index) => ({
      path: `/tmp/${index}.md`,
      status: "modified" as const,
    }));
    expect(budget.take("turn-1", files)).toHaveLength(INPUT_LIMITS.turnStepFiles);
    expect(budget.take("turn-1", [{ path: "/tmp/late.md", status: "modified" }])).toHaveLength(0);
    budget.drop("turn-1");
    expect(budget.take("turn-1", [{ path: "/tmp/late.md", status: "modified" }])).toHaveLength(1);
  });
});
