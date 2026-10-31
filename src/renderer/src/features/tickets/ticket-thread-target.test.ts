import type { AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { ticketThreadTarget } from "./ticket-thread-target";

function snapshot(agentId: string, tasks: { id: string; threadId: string }[]): AgentTasksSnapshot {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: A test snapshot carries only the fields the lookup reads.
  return { agentId, limit: 1, tasks: tasks.map((task) => ({ ...task, agentId })) } as unknown as AgentTasksSnapshot;
}

describe("ticket 255: Open thread", () => {
  const snapshots = {
    builder2: snapshot("builder2", [{ id: "task-b", threadId: "thread-b" }]),
    planner: snapshot("planner", [{ id: "task-p", threadId: "thread-p" }]),
  };
  it("opens the task under the agent that owns it, not the ticket's agent", () => {
    expect(ticketThreadTarget({ agentId: "builder2", taskId: "task-p", threadId: "thread-p" }, snapshots)).toEqual({
      agentId: "planner",
      taskId: "task-p",
    });
  });
  it("finds the task by thread id", () => {
    expect(ticketThreadTarget({ agentId: "planner", taskId: null, threadId: "thread-b" }, snapshots)).toEqual({
      agentId: "builder2",
      taskId: "task-b",
    });
  });
  it("falls back to the agent's chat for a chat-taken ticket", () => {
    expect(ticketThreadTarget({ agentId: "planner", taskId: null, threadId: "chat-1" }, snapshots)).toEqual({
      agentId: "planner",
      taskId: null,
    });
    expect(ticketThreadTarget({ agentId: null, taskId: null, threadId: null }, snapshots)).toBeNull();
  });
});
