import { ArrowUp, Button, MessageCircleQuestionMark, X } from "@openbot/ui";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import { AgentActivityIndicator, nextAgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import { formatChatTimestamp } from "@openbot/ui/features/conversation/chat-timestamp";
import { useText } from "@openbot/ui/text";
import { createSignal, For, onSettled, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";

/** One question of a side question. The answer is null while the agent writes it. */
export interface SideQuestionExchange {
  id: string;
  question: string;
  askedAt: string;
  answer: string | null;
  answeredAt: string | null;
}

export interface SideQuestionPanelProps {
  agent: AgentProfile;
  agents: AgentProfile[];
  exchanges: readonly SideQuestionExchange[];
  /** Why the last question got no answer. The question is back in the draft. */
  error: string | null;
  draft: string;
  /** Raised by one to put the caret in the composer. */
  focusRequest: number;
  onDraftChange: (value: string) => void;
  onAsk: (question: string) => void;
  onClosePanel: () => void;
  onOpenLink: (url: string) => void;
  /** The title of the work thread (task) that the side chat reads. Absent for the main chat. */
  taskTitle?: string | undefined;
  /**
   * "Send to main thread": puts the text into the task as a user message, where it waits in the
   * queue while a turn runs. Resolves true when the task took it. Absent for the main chat.
   */
  onSendToMain?: ((text: string) => Promise<boolean>) | undefined;
}

function exchangeMessages(exchange: SideQuestionExchange): AgentMessage[] {
  const question: AgentMessage = {
    id: `${exchange.id}:question`,
    author: "you",
    body: exchange.question,
    time: formatChatTimestamp(new Date(exchange.askedAt)),
    createdAt: exchange.askedAt,
    kind: "text",
  };
  if (exchange.answer === null || exchange.answeredAt === null) return [question];
  return [
    question,
    {
      id: `${exchange.id}:answer`,
      author: "agent",
      body: exchange.answer,
      time: formatChatTimestamp(new Date(exchange.answeredAt)),
      createdAt: exchange.answeredAt,
      kind: "text",
    },
  ];
}

/**
 * A question about the chat that stays out of the chat. The agent answers with its own model, with
 * no tools, and nothing of it is kept: closing the pane deletes it.
 */
export function SideQuestionPanel(props: SideQuestionPanelProps) {
  const { t } = useText();
  const activityLabel = nextAgentActivityLabel();
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  const asking = () => props.exchanges.at(-1)?.answer === null;
  const [sendingToMain, setSendingToMain] = createSignal(false);
  /** The text that the task took last, so its row says it went. */
  const [sentToMain, setSentToMain] = createSignal<string | null>(null);
  const sendToMain = async (text: string, fromDraft: boolean) => {
    const send = props.onSendToMain;
    const body = text.trim();
    if (!send || !body || sendingToMain()) return;
    setSendingToMain(true);
    try {
      if (await send(body)) {
        setSentToMain(body);
        if (fromDraft) props.onDraftChange("");
      }
    } finally {
      setSendingToMain(false);
    }
  };
  const answerOf = (message: AgentMessage) =>
    message.author === "agent" && message.id.endsWith(":answer") ? message.body : null;
  const messages = () => props.exchanges.flatMap(exchangeMessages);
  const ask = () => {
    const question = props.draft.trim();
    if (!question || asking()) return;
    props.onAsk(question);
  };
  const author = (message: AgentMessage) =>
    message.author === "you"
      ? { kind: "you" as const, name: t("chat.message.you") }
      : { kind: "agent" as const, name: props.agent.name, agent: props.agent };
  return (
    <aside
      id="side-question-panel"
      class="browser-panel side-question-panel"
      aria-label={t("conversation.sidePanel.pane.question")}
    >
      <header class="file-preview-header side-panel-pane-header">
        <h2 class="side-panel-pane-title">{t("conversation.sidePanel.pane.question")}</h2>
        <Show when={props.taskTitle}>
          {(title) => (
            <span class="side-question-task" title={title()}>
              {t("conversation.sideQuestion.taskLabel", { title: title() })}
            </span>
          )}
        </Show>
        <Button
          type="button"
          variant="ghost"
          class="browser-toolbar-button side-panel-pane-close"
          aria-label={t("conversation.tasks.panel.closePanel")}
          onClick={() => props.onClosePanel()}
        >
          <X class="browser-toolbar-icon" />
        </Button>
      </header>
      <Show
        when={props.exchanges.length > 0}
        fallback={
          <div class="side-question-empty">
            <MessageCircleQuestionMark aria-hidden="true" />
            <Show
              when={props.taskTitle}
              fallback={
                <>
                  <strong>{t("conversation.sideQuestion.emptyTitle")}</strong>
                  <p>{t("conversation.sideQuestion.emptyBody", { name: props.agent.name })}</p>
                </>
              }
            >
              <strong>{t("conversation.sideQuestion.taskEmptyTitle")}</strong>
              <p>{t("conversation.sideQuestion.taskEmptyBody", { name: props.agent.name })}</p>
            </Show>
          </div>
        }
      >
        <section
          class={["conversation-scroll side-question-scroll", fades.classes()]}
          aria-label={t("conversation.sideQuestion.messages")}
          ref={fades.bind}
          onScroll={fades.measure}
        >
          <div class="virtual-chat-list virtual-chat-list-static" ref={fades.watch}>
            <For each={messages()} keyed={(message) => message.id}>
              {(message) => (
                <div class="virtual-chat-row">
                  <ChatMessageRow
                    message={message()}
                    author={author(message())}
                    agents={props.agents}
                    onSelectAgent={() => undefined}
                    onOpenLink={props.onOpenLink}
                    onPreview={() => undefined}
                    onAttachmentAction={() => undefined}
                  />
                  <Show when={props.onSendToMain && answerOf(message())}>
                    {(answer) => (
                      <div class="side-question-answer-actions">
                        <Button
                          variant="ghost"
                          size="xs"
                          type="button"
                          disabled={sendingToMain()}
                          onClick={() => void sendToMain(answer(), false)}
                        >
                          {t("conversation.sideQuestion.sendToMain")}
                        </Button>
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </For>
            <Show when={asking()}>
              <div class="virtual-chat-row">
                <AgentActivityIndicator agent={props.agent} label={activityLabel} />
              </div>
            </Show>
          </div>
        </section>
      </Show>
      <div class="composer-wrap">
        <Show when={props.taskTitle}>
          <p class="side-question-note">{t("conversation.sideQuestion.taskNote")}</p>
        </Show>
        <Show when={sentToMain()}>
          <p class="side-question-note" role="status">
            {t("conversation.sideQuestion.sentToMain")}
          </p>
        </Show>
        <Show when={props.error}>
          {(error) => (
            <ComposerNotice
              tone="danger"
              title={t("conversation.sideQuestion.failed")}
              body={error()}
              action={
                // The failed question is back in the draft, so Retry asks the draft again.
                <Show when={props.draft.trim()}>
                  <Button variant="outline" size="sm" type="button" disabled={asking()} onClick={ask}>
                    {t("common.retry")}
                  </Button>
                </Show>
              }
            />
          )}
        </Show>
        <form
          class="composer side-question-composer"
          data-compact="true"
          onSubmit={(event) => {
            event.preventDefault();
            ask();
          }}
        >
          <div class="composer-input-label">
            <ComposerEditor
              agentId={props.agent.id}
              agents={props.agents}
              value={props.draft}
              placeholder={t("conversation.sideQuestion.placeholder")}
              ariaLabel={t("conversation.sideQuestion.placeholder")}
              disabled={false}
              focusRequest={props.focusRequest}
              onSubmit={ask}
              onValueChange={props.onDraftChange}
            />
          </div>
          <div class="composer-toolbar">
            <div class="composer-primary-actions">
              <Show when={props.onSendToMain}>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={sendingToMain() || props.draft.trim().length === 0}
                  onClick={() => void sendToMain(props.draft, true)}
                >
                  {t("conversation.sideQuestion.sendDraftToMain")}
                </Button>
              </Show>
              <Button
                type="submit"
                variant="ghost"
                class="voice-button"
                aria-label={t("conversation.sideQuestion.send")}
                disabled={asking() || props.draft.trim().length === 0}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}
