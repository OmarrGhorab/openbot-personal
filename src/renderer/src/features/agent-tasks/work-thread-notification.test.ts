import type { AgentEvent, ClientAgentSummary } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { notificationForAgentEvent } from "@openbot/team-client/agent-notifications";
import { describe, expect, it } from "vitest";
import { STORY_FOREIGN_AGENT } from "../../preview/fixtures";

const translate = translateFor("en");

const agent: ClientAgentSummary = {
  ...STORY_FOREIGN_AGENT,
  id: "agent-1",
  name: "Ada",
  threadId: "main-thread",
  notifications: true,
};

const finished: AgentEvent = {
  type: "turn-completed",
  agentId: "agent-1",
  threadId: "task-thread",
  turnId: "turn-1",
  status: "completed",
};

describe("notificationForAgentEvent and work threads", () => {
  it("names the work thread in the title", () => {
    const content = notificationForAgentEvent(finished, [agent], translate, "all", null, null, { title: "Fix login" });
    expect(content?.title).toBe("Ada, task: Fix login");
    expect(content?.threadId).toBe("task-thread");
  });

  it("keeps the agent name without a work thread", () => {
    expect(notificationForAgentEvent(finished, [agent], translate, "all")?.title).toBe("Ada");
  });

  it("names the channel when a channel owns the thread", () => {
    const content = notificationForAgentEvent(
      finished,
      [agent],
      translate,
      "all",
      null,
      { id: "channel-1", name: "general" },
      { title: "Fix login" },
    );
    expect(content?.title).toBe("Ada in general");
  });
});
