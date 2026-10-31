import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import { AwaitingReplies, type AwaitingReplyItem } from "@openbot/ui/features/conversation/AwaitingReplies";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { agentAwaitingReplies } from "../src/awaiting-replies";
import { requireFixture, STORY_AGENTS } from "../src/preview/fixtures";

/*
 * The block above the composer while an agent waits for other agents. The agent chat shows the
 * agents it asked; a channel shows the sub-tasks that an owner waits for.
 */

const research: AgentProfile = requireFixture(STORY_AGENTS[1], "Research agent");
const sales: AgentProfile = requireFixture(STORY_AGENTS[2], "Sales agent");

const researchReplied: AwaitingReplyItem = {
  id: "reply-research",
  agent: research,
  name: research.name,
  state: "replied",
  preview: "All four sources check out. The pricing link now points to the new page.",
  detail: "Chief reads it next",
};

const items: AwaitingReplyItem[] = [
  researchReplied,
  { id: "reply-sales", agent: sales, name: sales.name, state: "working" },
  { id: "reply-support", name: "Support", state: "asked" },
];

const meta = {
  title: "Conversation/Awaiting replies",
  component: AwaitingReplies,
  render: (args) => (
    <main style={{ width: "min(640px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <AwaitingReplies {...args} />
    </main>
  ),
  args: { items },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof AwaitingReplies>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = {};

/** The person closed the block. The header names the agent that works. */
export const Collapsed: Story = { args: { defaultOpen: false } };

export const OneFailed: Story = {
  args: {
    items: [
      { id: "reply-research", agent: research, name: research.name, state: "failed" },
      { id: "reply-sales", agent: sales, name: sales.name, state: "working" },
    ],
  },
};

/*
 * Issue #310: the teammate's answer is already in the transcript (its reply left the queue when
 * it was read), but the outgoing delivery still runs. The row must show Replied, not Working.
 * The items come from the real `agentAwaitingReplies`, so this story goes red on the old code.
 */
const issue310Self: AgentProfile = requireFixture(STORY_AGENTS[0], "Story agent");
const issue310Mate: AgentProfile = requireFixture(STORY_AGENTS[1], "Research agent");
const issue310Messages: AgentMessage[] = [
  {
    id: "outbox-issue310",
    author: "agent",
    body: "Please add the missing acceptance case.",
    time: "2026-10-31T17:09:55.436Z",
    exchange: {
      direction: "outgoing",
      messageId: "issue310-m1",
      senderAgentId: issue310Self.id,
      recipientAgentIds: [issue310Mate.id],
      replyToMessageId: null,
      deliveries: [
        { id: "issue310-d1", recipientAgentId: issue310Mate.id, status: "running", position: null, error: null },
      ],
    },
  },
  {
    id: "issue310-reply",
    author: "agent",
    body: "Status: done\nResult: Added the story.\nEvidence: typecheck passed.",
    time: "2026-10-31T17:13:52.593Z",
    senderAgentId: issue310Mate.id,
    replyToMessageId: "issue310-m1",
    exchange: {
      direction: "incoming",
      messageId: "issue310-reply",
      senderAgentId: issue310Mate.id,
      recipientAgentIds: [issue310Self.id],
      replyToMessageId: "issue310-m1",
      expectsReply: false,
      deliveries: [
        { id: "issue310-d2", recipientAgentId: issue310Self.id, status: "completed", position: null, error: null },
      ],
    },
  },
];

const issue310Items = agentAwaitingReplies({
  messages: issue310Messages,
  queue: { agentId: issue310Self.id, deliveries: [] },
  agents: [issue310Self, issue310Mate],
  self: issue310Self,
});

export const Issue310AnsweredWhileRunning: Story = {
  render: () => (
    <main style={{ width: "min(640px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <AwaitingReplies items={issue310Items} />
    </main>
  ),
};

/** Every agent is done, so the block has a close button. */
export const AllReplied: Story = {
  args: {
    onDismiss: fn(),
    items: items.map((item) => ({ ...item, state: "replied", detail: "Chief reads it next" })),
  },
};

/** A channel owner that waits for the sub-tasks it gave out. */
export const ChannelSubtasks: Story = {
  args: {
    title: "Waiting for sub-tasks",
    items: [
      {
        id: "task-research",
        agent: research,
        name: research.name,
        state: "replied",
        preview: "Check the sources in the launch notes",
        detail: "Chief reads it next",
      },
      {
        id: "task-sales",
        agent: sales,
        name: sales.name,
        state: "working",
        preview: "Draft the pricing section for the launch post",
      },
    ],
  },
};

/** An agent that was asked waits for an approval in its own chat. Review opens that chat. */
export const NeedsApproval: Story = {
  args: {
    onOpenAgent: fn(),
    items: [
      researchReplied,
      {
        id: "reply-sales",
        agent: sales,
        name: sales.name,
        state: "working",
        wait: { kind: "waiting", reason: "approval", detail: "rm -r drafts/pricing-old" },
      },
    ],
  },
};

/** An agent that was asked has a question for the person. */
export const AsksQuestion: Story = {
  args: {
    onOpenAgent: fn(),
    items: [
      researchReplied,
      {
        id: "reply-sales",
        agent: sales,
        name: sales.name,
        state: "working",
        wait: { kind: "waiting", reason: "question", detail: "Which region should we launch in first?" },
      },
    ],
  },
};

/** The plan of an agent that was asked is spent. Nobody can act, so the row has no button. */
export const UsageLimit: Story = {
  args: {
    onOpenAgent: fn(),
    items: [
      researchReplied,
      {
        id: "reply-sales",
        agent: sales,
        name: sales.name,
        state: "asked",
        wait: { kind: "limited", resetsAt: Math.floor(Date.now() / 1_000) + 2 * 60 * 60 },
      },
    ],
  },
};
