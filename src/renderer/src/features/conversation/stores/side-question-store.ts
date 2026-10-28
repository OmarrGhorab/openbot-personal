import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { SIDE_QUESTION_CAPABILITY } from "@openbot/contracts/team-protocol/side-question-v1";
import type { SideQuestionExchange } from "@openbot/ui/features/conversation/SideQuestionPanel";
import { currentText } from "@openbot/ui/text";
import type { Store, StoreSetter } from "solid-js";
import { serverSupportsCapability } from "../../servers/server-capabilities";
import { conversationPort } from "../conversation-port";
import type { ConversationProps } from "../conversation-types";

// Each member reads the interface language when it is called.
const { t, errorMessage } = currentText();

/** The side question of one agent. Only this window holds it: nothing on the host keeps it. */
export interface SideQuestionState {
  draft: string;
  exchanges: SideQuestionExchange[];
  error: string | null;
  focusRequest: number;
  /**
   * The work thread (agent task) that the side chat reads, or null for the agent's main chat. Only
   * this computer reads a task: a joined server answers about the main chat.
   */
  taskId: string | null;
}

const SIDE_QUESTION_EMPTY: SideQuestionState = {
  draft: "",
  exchanges: [],
  error: null,
  focusRequest: 0,
  taskId: null,
};

export interface SideQuestionStoreDeps {
  props: ConversationProps;
  /** Owned by the server's conversation state, so that a side question outlives the view of its chat. */
  questions: Store<Record<string, SideQuestionState>>;
  setQuestions: StoreSetter<Record<string, SideQuestionState>>;
  /** Opens the side question pane of the agent on screen. */
  openPane: () => void;
}

export function createSideQuestionStore(deps: SideQuestionStoreDeps) {
  const { questions, setQuestions } = deps;

  /** The host that runs the agent answers a side question. A joined server or a web host needs `side-question-v1`. */
  const sideQuestionAvailable = () =>
    deps.props.runtime
      ? Boolean(deps.props.runtime.askSideQuestion)
      : serverSupportsCapability(deps.props.server, SIDE_QUESTION_CAPABILITY);
  const sideQuestion = (): SideQuestionState => {
    const agentId = deps.props.agent?.id;
    return (agentId && questions[agentId]) || SIDE_QUESTION_EMPTY;
  };
  /**
   * One side composer shows the side question of each agent in turn, so a focus request must be higher
   * than the request of each agent.
   */
  const nextFocusRequest = () => Math.max(0, ...Object.values(questions).map((state) => state.focusRequest)) + 1;
  function update(agentId: string, change: (state: SideQuestionState) => void) {
    setQuestions((draft) => {
      draft[agentId] ??= { ...SIDE_QUESTION_EMPTY, exchanges: [] };
      change(draft[agentId]);
    });
  }

  function setSideQuestionDraft(text: string) {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    update(agentId, (state) => {
      state.draft = text;
    });
  }

  /**
   * Opens the pane with the caret in its composer. Text from the chat composer goes to the end of its
   * draft. `taskId` attaches the side chat to a work thread, or to the main chat when null. The
   * exchanges are about one thread, so a side chat that moves to another thread starts empty.
   */
  function openSideQuestion(text = "", taskId: string | null = null) {
    const agentId = deps.props.agent?.id;
    if (!agentId || !sideQuestionAvailable()) return;
    // Only this computer keeps tasks; a joined server answers about the main chat.
    const thread = deps.props.tasks ? taskId : null;
    const question = text.trim();
    update(agentId, (state) => {
      if (state.taskId !== thread) {
        state.taskId = thread;
        state.exchanges = [];
        state.error = null;
      }
      if (question) state.draft = state.draft.trim() ? `${state.draft.trim()}\n${question}` : question;
      state.focusRequest = nextFocusRequest();
    });
    deps.openPane();
  }

  function askSideQuestion(question: string) {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    const state = questions[agentId] ?? SIDE_QUESTION_EMPTY;
    if (state.exchanges.at(-1)?.answer === null) return;
    const earlier = state.exchanges.slice(-INPUT_LIMITS.sideQuestionTurns).flatMap((exchange) =>
      exchange.answer === null
        ? []
        : [
            {
              // The prompt reads only the start of each turn. A shorter body also stays under a host's
              // request limit. A longer answer still shows in full here.
              question: exchange.question.slice(0, INPUT_LIMITS.sideQuestionEarlierText),
              answer: exchange.answer.slice(0, INPUT_LIMITS.sideQuestionEarlierText),
            },
          ],
    );
    const id = crypto.randomUUID();
    update(agentId, (draft) => {
      draft.exchanges.push({ id, question, askedAt: new Date().toISOString(), answer: null, answeredAt: null });
      draft.draft = "";
      draft.error = null;
    });
    const runtimeAsk = deps.props.runtime?.askSideQuestion;
    // The server is fixed now, so an answer cannot come from a server the user switches to.
    const serverId = deps.props.server?.id;
    // The side chat of a work thread reads a snapshot of that task on this computer.
    const taskId = runtimeAsk ? null : state.taskId;
    const ask = runtimeAsk
      ? runtimeAsk({ agentId, question, earlier })
      : conversationPort().agent.askSideQuestion(
          { agentId, question, earlier, ...(taskId ? { taskId } : {}) },
          serverId,
        );
    void ask.then(
      (answer) => {
        if (!questions[agentId]) return;
        update(agentId, (draft) => {
          const exchange = draft.exchanges.find((item) => item.id === id);
          if (!exchange) return;
          exchange.answer = answer;
          exchange.answeredAt = new Date().toISOString();
        });
      },
      (error) => {
        if (!questions[agentId]) return;
        update(agentId, (draft) => {
          if (!draft.exchanges.some((item) => item.id === id)) return;
          // The question goes back to the composer, before text typed since, so that Send asks it again.
          draft.exchanges = draft.exchanges.filter((item) => item.id !== id);
          draft.error = errorMessage(error, t("conversation.sideQuestion.error"));
          draft.draft = draft.draft.trim() ? `${question}\n${draft.draft.trim()}` : question;
          draft.focusRequest = nextFocusRequest();
        });
      },
    );
  }

  /**
   * "Send to main thread": the text goes into the work thread as a user message. While its turn runs,
   * it waits in the task queue or steers, as any message does. The side chat itself never changes the task.
   */
  async function sendSideQuestionToThread(text: string): Promise<boolean> {
    const taskId = sideQuestion().taskId;
    const tasks = deps.props.tasks;
    const body = text.trim();
    if (!taskId || !tasks || !body) return false;
    return tasks.onSend(taskId, body);
  }

  /** Closing the pane deletes the side question. An answer that comes later finds no question and is dropped. */
  function deleteSideQuestion() {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    setQuestions((draft) => {
      delete draft[agentId];
    });
  }

  return {
    sideQuestionAvailable,
    sideQuestion,
    setSideQuestionDraft,
    openSideQuestion,
    askSideQuestion,
    sendSideQuestionToThread,
    deleteSideQuestion,
  };
}
