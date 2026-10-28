import { CHAT_VISUAL_ITEM_TYPE_PREFIX } from "@openbot/contracts/chat-visual";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentSummary,
  type AskSideQuestionInput,
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  type ConversationMessage,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { tagSafe } from "./developer-instructions";

/** The chat messages a side question reads, newest last. */
export const SIDE_QUESTION_CHAT_MESSAGES = 60;
const MESSAGE_CHARACTERS = INPUT_LIMITS.sideQuestionEarlierText;
const CHAT_CHARACTERS = 60_000;
const EARLIER_CHARACTERS = 60_000;

/** Indented JSON for a prompt block, with `<` escaped as `tagSafe` does. */
function promptJson(value: unknown): string {
  return tagSafe(JSON.stringify(value, null, 2));
}

/** A message that a person or the agent wrote in the chat, not a tool step or a status line. */
function chatMessage(message: ConversationMessage): boolean {
  return (
    (message.author === "user" || message.author === "assistant" || message.author === "agent") &&
    message.text.trim().length > 0 &&
    message.itemType !== "commentary" &&
    message.itemType !== "question_prompt" &&
    message.itemType !== "agent_attachment" &&
    !message.itemType?.startsWith(CHAT_VISUAL_ITEM_TYPE_PREFIX) &&
    message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
    message.itemType !== CONVERSATION_SUBAGENTS_ITEM_TYPE &&
    message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE
  );
}

function chatTranscript(agent: AgentSummary, messages: readonly ConversationMessage[]) {
  const entries: { from: string; text: string }[] = [];
  let characters = 0;
  for (const message of [...messages].filter(chatMessage).reverse()) {
    const text = message.text.slice(0, MESSAGE_CHARACTERS);
    if (characters + text.length > CHAT_CHARACTERS) break;
    characters += text.length;
    const from =
      message.author === "user"
        ? (message.senderMember?.name ?? "User")
        : message.senderAgentId
          ? "Another agent"
          : agent.name;
    entries.push({ from, text });
  }
  return entries.reverse();
}

/** The newest earlier side questions that fit the budget, oldest first. */
function earlierTurns(input: AskSideQuestionInput) {
  const turns: AskSideQuestionInput["earlier"] = [];
  let characters = 0;
  for (const turn of [...input.earlier].reverse()) {
    const question = turn.question.slice(0, MESSAGE_CHARACTERS);
    const answer = turn.answer.slice(0, MESSAGE_CHARACTERS);
    if (characters + question.length + answer.length > EARLIER_CHARACTERS) break;
    characters += question.length + answer.length;
    turns.push({ question, answer });
  }
  return turns.reverse();
}

/**
 * The read-only snapshot of a work thread (agent task) that a side chat reads beside its messages.
 * `changedFiles` is the `git diff --stat` of its worktree, or null for a thread that shares the
 * workspace or a worktree that git could not read.
 */
export interface SideQuestionWorkThread {
  title: string;
  changedFiles: string | null;
}

/** The newest plan of the thread, as its checklist text, or null when the thread has none. */
export function latestPlanText(messages: readonly ConversationMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.itemType === CONVERSATION_PLAN_ITEM_TYPE && message.text.trim())
      return message.text.slice(0, MESSAGE_CHARACTERS);
  }
  return null;
}

/**
 * The prompt of a side question: the agent's profile, the end of its chat, the earlier side turns, and
 * the question. The generation has no tools, so the answer can only come from this text. With
 * `thread`, the chat is that work thread, and its plan and changed files come with it.
 */
export function sideQuestionPrompt(
  agent: AgentSummary,
  messages: readonly ConversationMessage[],
  input: AskSideQuestionInput,
  thread: SideQuestionWorkThread | null = null,
): string {
  const earlier = earlierTurns(input);
  const plan = thread ? latestPlanText(messages) : null;
  return [
    thread
      ? "You are the agent in this profile. The user asks a side question about one of your tasks while it may still run. The question and your answer stay out of the task, and you cannot use tools here or change the task. Answer from the task snapshot and from what you know. Give the shortest complete answer in plain text or Markdown."
      : "You are the agent in this profile. The user asks a side question about your chat with them. The question and your answer stay out of the chat, and you cannot use tools here. Answer from the chat and from what you know. Give the shortest complete answer in plain text or Markdown.",
    "<agent_profile>",
    promptJson({
      name: agent.name,
      title: agent.title.trim() || "General assistant",
      description: agent.description.trim() || "No additional description configured.",
    }),
    "</agent_profile>",
    "<chat>",
    promptJson(chatTranscript(agent, messages)),
    "</chat>",
    ...(thread
      ? [
          "<task>",
          promptJson({
            title: thread.title,
            plan: plan ?? "No plan.",
            changedFiles: thread.changedFiles ?? "Not known: the task shares the workspace or git could not read it.",
          }),
          "</task>",
        ]
      : []),
    ...(earlier.length > 0 ? ["<earlier_side_questions>", promptJson(earlier), "</earlier_side_questions>"] : []),
    "<side_question>",
    promptJson(input.question),
    "</side_question>",
  ].join("\n");
}
