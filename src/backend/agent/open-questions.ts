import { OPEN_QUESTIONS_LIMIT, type OpenQuestion, type OpenQuestionsSnapshot } from "@openbot/contracts/ipc";
import type { OpenQuestionSource } from "./attention-registry";

/** The work thread that owns a thread, as the task store knows it: null for the agent's own chat. */
export interface OpenQuestionTask {
  taskId: string;
  title: string;
}

/**
 * The Questions list: each question that waits for an answer, with the name of its agent and, for a
 * work thread, its task. A question of an agent that no longer exists is left out. Oldest first, at
 * most `OPEN_QUESTIONS_LIMIT`.
 *
 * It never reads the registry or the stores itself: the caller passes what they hold, so this join
 * stays a plain function.
 */
export function openQuestionsSnapshot(
  sources: readonly OpenQuestionSource[],
  agents: readonly { id: string; name: string }[],
  taskOfThread: (threadId: string) => OpenQuestionTask | null,
): OpenQuestionsSnapshot {
  const questions: OpenQuestion[] = [];
  for (const source of sources) {
    if (questions.length >= OPEN_QUESTIONS_LIMIT) break;
    const agent = agents.find((candidate) => candidate.id === source.agentId);
    if (!agent) continue;
    const task = taskOfThread(source.threadId);
    questions.push({
      requestId: source.requestId,
      agentId: source.agentId,
      agentName: agent.name,
      threadId: source.threadId,
      taskId: task?.taskId ?? null,
      taskTitle: task?.title ?? null,
      turnId: source.turnId,
      questions: source.questions,
    });
  }
  return { questions };
}
