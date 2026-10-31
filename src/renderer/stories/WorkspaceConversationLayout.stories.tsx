import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { OpenBotPlayground } from "../src/preview/OpenBotPlayground";
import { requireFixture, STORY_AGENT_SUMMARIES, STORY_CONVERSATION_MESSAGES, STORY_SNAPSHOTS } from "./fixtures";

const activeTurnId = "workspace-layout-active-turn";
const userMessage = requireFixture(
  STORY_CONVERSATION_MESSAGES.find((message) => message.author === "user"),
  "Story user message",
);
const agentMessage = requireFixture(
  STORY_CONVERSATION_MESSAGES.find((message) => message.author === "assistant" && message.itemType === undefined),
  "Story agent message",
);

const longHistory = Array.from({ length: 36 }, (_, index) => {
  const isUser = index % 2 === 0;
  const template = isUser ? userMessage : agentMessage;
  return {
    ...template,
    id: `workspace-layout-message-${index + 1}`,
    text: isUser
      ? `Review item ${index + 1}: keep the decision and its evidence in the conversation history. Confirm the owner, the affected UI, and the expected result before this change is ready.`
      : `Review item ${index + 1} is checked. The evidence, owner, and visible result are recorded here so the long conversation remains scrollable while the response is active.`,
    createdAt: new Date(Date.UTC(2026, 9, 30, 9, index)).toISOString(),
    ...(index === 35 ? { status: "streaming" as const, turnId: activeTurnId } : {}),
  };
});

const chiefSnapshot = requireFixture(STORY_SNAPSHOTS.chief, "Story Chief snapshot");
const options = {
  languagePreference: { language: "ar" as const },
  agents: STORY_AGENT_SUMMARIES.slice(0, 1),
  snapshots: {
    ...STORY_SNAPSHOTS,
    chief: {
      ...chiefSnapshot,
      revision: chiefSnapshot.revision + 1,
      activeTurnId,
      messages: longHistory,
    },
  },
};

const meta = {
  title: "App/Workspace conversation layout",
  parameters: {
    layout: "fullscreen",
    viewport: {
      defaultViewport: "workspaceNarrow",
      options: {
        workspaceNarrow: { name: "Narrow — 680 × 900", styles: { width: "680px", height: "900px" } },
        workspaceWide: { name: "Wide — 1200 × 820", styles: { width: "1200px", height: "820px" } },
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open the composer model picker to inspect its layer above the real app frame and long chat. */
export const ActiveChatWithModelPicker: Story = {
  render: () => <OpenBotPlayground options={options} />,
};
