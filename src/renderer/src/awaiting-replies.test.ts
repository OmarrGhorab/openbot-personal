import type { QueueSnapshot } from "@openbot/contracts/ipc";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import { describe, expect, it } from "vitest";
import { agentAwaitingReplies } from "./awaiting-replies";

const AT = "2026-10-31T17:13:52.593Z";

const profile = (id: string, name: string): AgentProfile => ({
  id,
  name,
  title: name,
  description: name,
  notifications: false,
  provider: "codex",
  model: "gpt-6-luna",
  reasoningEffort: "medium",
  threadId: null,
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
  time: AT,
  preview: "",
});

const self = profile("debug", "Debugging Partner");
const teammate = profile("impl", "Feature Implementer");

const outbox = (status: "queued" | "starting" | "running" | "completed"): AgentMessage => ({
  id: "outbox-m1",
  author: "agent",
  body: "Please add the missing acceptance case.",
  time: AT,
  exchange: {
    direction: "outgoing",
    messageId: "m1",
    senderAgentId: self.id,
    recipientAgentIds: [teammate.id],
    replyToMessageId: null,
    deliveries: [{ id: "d1", recipientAgentId: teammate.id, status, position: null, error: null }],
  },
});

/** The teammate's answer as the transcript shows it after the reply was read. */
const transcriptAnswer = (): AgentMessage => ({
  id: "reply-1",
  author: "agent",
  body: "Status: done\nResult: Added the story.\nEvidence: typecheck passed.",
  time: AT,
  senderAgentId: teammate.id,
  replyToMessageId: "m1",
  exchange: {
    direction: "incoming",
    messageId: "reply-1",
    senderAgentId: teammate.id,
    recipientAgentIds: [self.id],
    replyToMessageId: "m1",
    expectsReply: false,
    deliveries: [{ id: "d2", recipientAgentId: self.id, status: "completed", position: null, error: null }],
  },
});

const input = (messages: readonly AgentMessage[]) => ({
  messages,
  queue: { agentId: self.id, deliveries: [] } satisfies QueueSnapshot,
  agents: [self, teammate],
  self,
});

describe("agentAwaitingReplies", () => {
  it("marks the teammate replied when the transcript holds its answer but the delivery still runs", () => {
    const rows = agentAwaitingReplies(input([outbox("running"), transcriptAnswer()]));
    expect(rows.map((row) => [row.name, row.state])).toEqual([["Feature Implementer", "replied"]]);
  });

  it("keeps the teammate working while no answer arrived", () => {
    const rows = agentAwaitingReplies(input([outbox("running")]));
    expect(rows.map((row) => [row.name, row.state])).toEqual([["Feature Implementer", "working"]]);
  });

  it("hides the exchange once the delivery landed and no answer waits", () => {
    const rows = agentAwaitingReplies(input([outbox("completed")]));
    expect(rows).toEqual([]);
  });
});
