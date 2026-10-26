// @vitest-environment node

import {
  buildMonitorConversation,
  type ChannelPage,
  type ConversationMessage,
  isMonitorSnapshot,
  type MonitorAgentSource,
  type MonitorConversationEntry,
  type MonitorSnapshot,
} from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorService, redactMonitorSnapshot } from "../monitor-service";
import { monitorIpcHandlers } from "./monitor-handlers";

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
const AT = "2026-10-26T09:00:00.000Z";
const SECRET = "sk-live-4f9a8b7c6d5e4f3a2b1c";

const AGENTS: MonitorAgentSource[] = [
  { id: "agent-dev", name: "Developer", provider: "codex", avatarSeed: "agent-dev", avatarHue: null, avatarUrl: null },
  { id: "agent-qa", name: "Tester", provider: "claude", avatarSeed: "agent-qa", avatarHue: null, avatarUrl: null },
];

function agentMessage(): ConversationMessage {
  return {
    id: "message-1",
    turnId: "turn-1",
    author: "agent",
    text: "Deployed.",
    createdAt: AT,
    status: "completed",
    trace: {
      startedAt: AT,
      endedAt: "2026-10-26T09:00:05.000Z",
      steps: [
        {
          id: "step-1",
          kind: "tool",
          command: `curl -H "Authorization: Bearer ${SECRET}" https://api.example.com/deploy`,
          startedAt: AT,
          endedAt: "2026-10-26T09:00:02.000Z",
        },
      ],
    },
  };
}

function page(): ChannelPage {
  return {
    channel: {
      id: "channel-1",
      name: "launch",
      title: "Launch",
      instructions: "",
      members: [{ agentId: "agent-dev" }, { agentId: "agent-qa" }],
      leadAgentId: "agent-dev",
      archived: false,
      revision: 1,
      createdAt: AT,
    },
    messages: [
      {
        id: "channel-message-1",
        channelId: "channel-1",
        sequence: 1,
        author: { kind: "agent", id: "agent-dev", name: "Developer" },
        taskId: null,
        superseded: false,
        message: agentMessage(),
      },
    ],
    tasks: [],
    olderCursor: null,
    throughSequence: 1,
  };
}

function event(senderId: number, url = "openbot-app://app/index.html") {
  return { senderFrame: { url }, sender: { id: senderId } };
}

function register() {
  const monitor = new MonitorService({
    sources: {
      channelPage: (channelId) => {
        if (channelId !== "channel-1") throw new Error("missing");
        return page();
      },
      agents: () => AGENTS,
      agentTasks: () => [],
      taskMessages: () => [],
      channelExchanges: () => [],
      channelConversation: () => [],
      channelForThread: () => "channel-1",
    },
    onChange: () => {},
    now: () => new Date(AT),
  });
  const snapshot = vi.spyOn(monitor, "snapshot");
  const { monitor: handlers } = monitorIpcHandlers({ monitor, mainRendererIds: () => new Set([MAIN_ID]) });
  for (const [name, bind] of Object.entries(handlers)) bind(`monitor:${name}`);
  const call = (senderId: number, payload: unknown, url?: string) => {
    const listener = registrations.get("monitor:getSnapshot");
    if (!listener) throw new Error("No monitor handler.");
    return listener(event(senderId, url), payload);
  };
  /** A read from the main window, checked with the contract guard the preload decoder uses. */
  const read = async (channelId: string): Promise<MonitorSnapshot> => {
    const result = await call(MAIN_ID, { channelId });
    if (!isMonitorSnapshot(result)) throw new Error("The snapshot does not pass the contract guard.");
    return result;
  };
  return { monitor, snapshot, call, read };
}

beforeEach(() => registrations.clear());
afterEach(() => vi.restoreAllMocks());

describe("monitor snapshot handler", () => {
  it("redacts a secret in a finished tool call before the snapshot leaves main", async () => {
    const { read } = register();
    const result = await read("channel-1");
    const [toolCall] = result.toolCalls;
    expect(toolCall?.tool).toBe("shell");
    expect(toolCall?.status).toBe("done");
    expect(toolCall?.argument).toContain("[redacted]");
    expect(toolCall?.input).toContain("[redacted]");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("redacts a secret in the input and the output of a tool call, and keeps the diff lines", async () => {
    const { read } = register();
    const result = await read("channel-1");
    const [toolCall] = result.toolCalls;
    if (!toolCall) throw new Error("The fixture has no tool call.");
    const withOutput = {
      ...result,
      toolCalls: [
        {
          ...toolCall,
          input: `curl -H "Authorization: Bearer ${SECRET}" https://api.example.com/deploy`,
          output: `Authorization: Bearer ${SECRET}\n+ deployed\n- stale`,
        },
      ],
    };
    const redacted = redactMonitorSnapshot(withOutput);
    const [redactedCall] = redacted.toolCalls;
    expect(redactedCall?.input).toContain("[redacted]");
    expect(redactedCall?.output).toContain("[redacted]");
    expect(redactedCall?.output).toContain("+ deployed");
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
  });

  it("redacts a secret in a running tool call from the live agent events", async () => {
    const { monitor, read } = register();
    monitor.observe({ type: "turn-started", agentId: "agent-qa", threadId: "thread-qa", turnId: "turn-live" });
    monitor.observe({
      type: "turn-progress",
      agentId: "agent-qa",
      threadId: "thread-qa",
      turnId: "turn-live",
      detail: `Running export API_KEY=${SECRET}`,
    });
    const result = await read("channel-1");
    const running = result.toolCalls.find((toolCall) => toolCall.status === "running");
    expect(running?.agentId).toBe("agent-qa");
    expect(running?.argument).toContain("[redacted]");
    expect(result.agents.find((agent) => agent.id === "agent-qa")?.status).toBe("working");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    monitor.dispose();
  });

  it("refuses a window other than the main window before it reads anything", () => {
    const { snapshot, call } = register();
    expect(() => call(CHAT_WINDOW_ID, { channelId: "channel-1" })).toThrow("outside the main renderer");
    expect(() => call(CHAT_WINDOW_ID, { channelId: 42 })).toThrow("outside the main renderer");
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("refuses a renderer outside the app and a bad payload", () => {
    const { snapshot, call } = register();
    expect(() => call(MAIN_ID, { channelId: "channel-1" }, "https://evil.example/")).toThrow("untrusted renderer");
    expect(() => call(MAIN_ID, { channelId: "" })).toThrow("Provide a valid channel.");
    expect(snapshot).not.toHaveBeenCalled();
  });
});

describe("monitor conversation", () => {
  const entry = (
    messageId: string,
    senderAgentId: string,
    recipientAgentId: string,
    at: string,
    text: string,
  ): MonitorConversationEntry => ({ messageId, senderAgentId, recipientAgentId, at, text });

  it("counts and lists only the messages between the two agents, and redacts their text", () => {
    const entries = [
      entry("m1", "agent-dev", "agent-qa", "2026-10-26T09:00:00.000Z", `ship with ${SECRET}`),
      entry("m2", "agent-qa", "agent-dev", "2026-10-26T09:01:00.000Z", "ok"),
      entry("m3", "agent-dev", "agent-chief", "2026-10-26T09:02:00.000Z", "other pair"),
    ];
    const conversation = buildMonitorConversation(
      { channelId: "channel-1", agentIds: ["agent-qa", "agent-dev"] },
      entries,
      redactText,
    );
    expect(conversation.total).toBe(2);
    expect(conversation.messages.map((message) => message.id)).toEqual(["m1:agent-qa", "m2:agent-dev"]);
    expect(conversation.messages[0]?.text).toContain("[redacted]");
    expect(JSON.stringify(conversation)).not.toContain(SECRET);
  });
});
