import type { OpenQuestion } from "@openbot/contracts/ipc";
import { QuestionPromptBubble } from "@openbot/ui/components/QuestionPromptBubble";
import { type TextValue, useText } from "@openbot/ui/text";
import { createUniqueId, For } from "solid-js";

export interface TaskQuestionsProps {
  /** Every question that waits for an answer on this computer, oldest first. */
  questions: readonly OpenQuestion[];
  /** Sends the answers to the question. Resolves to false when the answer was not sent. */
  onAnswer: (question: OpenQuestion, answers: Record<string, string[]>) => Promise<boolean>;
}

/** The label of the agent and the place that asks: its task, or its own chat. */
function questionFrom(question: OpenQuestion, t: TextValue["t"]): string {
  if (question.taskTitle !== null) {
    return t("conversation.questions.fromTask", { agent: question.agentName, task: question.taskTitle });
  }
  return t("conversation.questions.fromChat", { agent: question.agentName });
}

/**
 * The questions of all agents, above the task list. Each one answers with the same card as the chat,
 * so a question reads and works the same wherever the user meets it.
 */
export function TaskQuestions(props: TaskQuestionsProps) {
  const { t } = useText();
  const ids = createUniqueId();
  return (
    <section class="tasks-page-section tasks-page-questions" aria-labelledby={`${ids}-questions`}>
      <h3 id={`${ids}-questions`} class="tasks-page-section-heading">
        <span>{t("conversation.questions.title")}</span>
        <span class="tasks-page-count">{props.questions.length}</span>
      </h3>
      <ul class="tasks-page-list">
        <For each={props.questions} keyed={(question) => `${question.turnId}:${String(question.requestId)}`}>
          {(question) => (
            <li class="tasks-page-question">
              <p class="tasks-page-question-from">{questionFrom(question(), t)}</p>
              <QuestionPromptBubble
                questions={question().questions}
                onSubmit={(answers) => props.onAnswer(question(), answers)}
              />
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
