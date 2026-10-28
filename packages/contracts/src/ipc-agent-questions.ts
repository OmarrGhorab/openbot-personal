import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier, isNullableBoundedString, isRequestId } from "./ipc-bounded-values";
import { type AgentPromptQuestion, isAgentPromptQuestion } from "./ipc-conversation-messages";
import { isDynamicRecord } from "./runtime-values";

/** The most open questions that the Questions list returns, oldest first. */
export const OPEN_QUESTIONS_LIMIT = 100;

/**
 * A question that an agent asks and that waits for the user, in any agent and any thread of this
 * computer. A question of a work thread names the task; a question of the agent's own chat has no task.
 * Answer it with `respondToPrompt`, using `requestId`.
 */
export interface OpenQuestion {
  requestId: string | number;
  agentId: string;
  agentName: string;
  /** The thread that asks: the agent's own chat, or the thread of a work thread. */
  threadId: string;
  /** The work thread that asks, or null for the agent's own chat. */
  taskId: string | null;
  taskTitle: string | null;
  turnId: string;
  questions: AgentPromptQuestion[];
}

export interface OpenQuestionsSnapshot {
  questions: OpenQuestion[];
}

export function isOpenQuestion(value: unknown): value is OpenQuestion {
  return (
    isDynamicRecord(value) &&
    isRequestId(value.requestId) &&
    isIdentifier(value.agentId) &&
    isBoundedString(value.agentName, INPUT_LIMITS.agentName) &&
    isIdentifier(value.threadId) &&
    (value.taskId === null || isIdentifier(value.taskId)) &&
    isNullableBoundedString(value.taskTitle, INPUT_LIMITS.agentTaskTitle) &&
    isIdentifier(value.turnId) &&
    Array.isArray(value.questions) &&
    value.questions.length <= INPUT_LIMITS.promptQuestions &&
    value.questions.every(isAgentPromptQuestion)
  );
}

export function isOpenQuestionsSnapshot(value: unknown): value is OpenQuestionsSnapshot {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.questions) &&
    value.questions.length <= OPEN_QUESTIONS_LIMIT &&
    value.questions.every(isOpenQuestion)
  );
}
