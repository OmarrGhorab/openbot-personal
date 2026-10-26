import type { MonitorSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { buildMonitorFeed } from "./monitor-feed";

const snapshot = (preview: string): MonitorSnapshot => ({
  channelId: "c1",
  channelName: "launch",
  revision: 1,
  generatedAt: "2026-10-26T00:00:00.000Z",
  agents: [],
  tasks: [],
  toolCalls: [],
  pairs: [],
  events: [
    {
      id: "e1",
      at: "2026-10-26T00:00:00.000Z",
      agentId: null,
      kind: "message",
      messageId: "m1",
      authorKind: "member",
      preview,
    },
  ],
});

describe("buildMonitorFeed", () => {
  it("shows a message preview as the chat preview does, without mention or attachment markdown", () => {
    const [entry] = buildMonitorFeed(snapshot("Ask @[Builder](agent:builder) to check **@[brief.md](file:brief.md)**"));
    expect(entry?.kind).toBe("message");
    const preview = entry?.kind === "message" ? entry.preview : "";
    expect(preview).not.toContain("](");
    expect(preview).not.toContain("**");
    expect(preview).toContain("@Builder");
  });
});
