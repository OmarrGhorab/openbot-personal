import type { MonitorAgent, MonitorSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { buildMonitorTaskRows, countMonitorTaskRows } from "./monitor-tasks";

const agent = (id: string, status: MonitorAgent["status"], currentTaskId: string | null = null): MonitorAgent => ({
  id,
  name: id,
  provider: "codex",
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
  lead: false,
  status,
  currentTaskId,
  step: null,
  startedAt: status === "working" ? "2026-10-26T00:00:00.000Z" : null,
  error: null,
});

const snapshot = (agents: MonitorAgent[], tasks: MonitorSnapshot["tasks"] = []): MonitorSnapshot => ({
  channelId: "c1",
  channelName: "personal-bot",
  revision: 1,
  generatedAt: "2026-10-26T00:00:00.000Z",
  agents,
  tasks,
  toolCalls: [
    {
      id: "t1",
      agentId: "a1",
      taskId: null,
      turnId: "turn1",
      tool: "read",
      argument: "x",
      input: null,
      output: null,
      status: "running",
      startedAt: "2026-10-26T00:00:01.000Z",
      endedAt: null,
      durationMs: null,
    },
  ],
  pairs: [],
  events: [],
});

describe("buildMonitorTaskRows", () => {
  it("shows a task title as plain text, without mention markdown", () => {
    const rows = buildMonitorTaskRows(
      snapshot(
        [agent("a1", "working", "task1")],
        [
          {
            id: "task1",
            source: "agent",
            agentId: "a1",
            parentTaskId: null,
            title: "Ask @[Builder](agent:builder) to check",
            state: "running",
            error: null,
            updatedAt: null,
          },
        ],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Ask @Builder to check");
    expect(countMonitorTaskRows(rows)).toMatchObject({ all: 1, running: 1 });
  });
});
