/**
 * The conversation between two agents of the Monitor, in a side drawer over the dimmed canvas. It is
 * read-only: nothing sends a message here. The text must already be redacted: the Monitor data
 * redacts it before it leaves the main process.
 *
 * Shared: it takes data and actions as props. Opening a thread is the caller's.
 */

import { Button, Dialog, IconButton, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

type ConversationAvatar = Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl">;

/** One of the two agents of the conversation. */
export interface ConversationDrawerAgent {
  id: string;
  name: string;
  agent: ConversationAvatar;
  /** The footer button that opens this agent's thread, such as "Open Developer thread". */
  openThreadLabel: string;
}

export interface ConversationDrawerMessage {
  id: string;
  senderName: string;
  sender: ConversationAvatar;
  /** The time, already formatted for the reader. */
  time: string;
  /** Redacted. */
  text: string;
}

export interface ConversationDrawerProps {
  open: boolean;
  /** Escape, a click on the dim layer and the close button call this. */
  onClose: () => void;
  /** The two agents, in the order the header shows them. */
  agents: readonly [ConversationDrawerAgent, ConversationDrawerAgent];
  /** The heading, such as "Developer and Designer". */
  title: string;
  /** The message count, such as "12 messages". The count of the line label. */
  countText: string;
  /** The time of the last message, such as "Last message 4m ago". Null when there is none. */
  lastText: string | null;
  /** Newest last. */
  messages: readonly ConversationDrawerMessage[];
  loading: boolean;
  /** The conversation could not be read. */
  error: string | null;
  /** Says that the list shows only the newest messages, such as "Showing the newest 200 of 240". */
  notice: string | null;
  onOpenThread: (agentId: string) => void;
}

export function ConversationDrawer(props: ConversationDrawerProps): JSX.Element {
  const { t } = useText();
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="monitor-drawer-overlay">
          <Dialog.Content class="monitor-drawer">
            <header class="monitor-drawer-header">
              <div class="monitor-drawer-avatars" aria-hidden="true">
                <AgentAvatar class="monitor-drawer-avatar" agent={props.agents[0].agent} />
                <AgentAvatar class="monitor-drawer-avatar" agent={props.agents[1].agent} />
              </div>
              <div class="monitor-drawer-heading">
                <Dialog.Title class="monitor-drawer-title">{props.title}</Dialog.Title>
                <Dialog.Description class="monitor-drawer-description">
                  <span>{props.countText}</span>
                  <Show when={props.lastText}>{(last) => <span>{last()}</span>}</Show>
                </Dialog.Description>
              </div>
              <IconButton
                variant="ghost"
                class="monitor-popup-close"
                label={t("common.close")}
                onClick={() => props.onClose()}
              >
                <X aria-hidden="true" />
              </IconButton>
            </header>

            <div class="monitor-drawer-body">
              <Show when={props.notice}>{(notice) => <p class="monitor-drawer-notice">{notice()}</p>}</Show>
              <Show
                when={!props.loading}
                fallback={<p class="monitor-drawer-empty">{t("monitor.conversation.loading")}</p>}
              >
                <Show when={!props.error} fallback={<p class="monitor-drawer-error">{props.error}</p>}>
                  <Show
                    when={props.messages.length > 0}
                    fallback={<p class="monitor-drawer-empty">{t("monitor.conversation.empty")}</p>}
                  >
                    <ol class="monitor-drawer-messages">
                      <For each={props.messages} keyed={(message) => message.id}>
                        {(message) => (
                          <li class="monitor-drawer-message">
                            <AgentAvatar class="monitor-drawer-message-avatar" agent={message().sender} />
                            <div class="monitor-drawer-message-body">
                              <div class="monitor-drawer-message-meta">
                                <span class="monitor-drawer-message-name">{message().senderName}</span>
                                <time>{message().time}</time>
                              </div>
                              <p class="monitor-drawer-message-text">
                                <bdi>{message().text}</bdi>
                              </p>
                            </div>
                          </li>
                        )}
                      </For>
                    </ol>
                  </Show>
                </Show>
              </Show>
            </div>

            <footer class="monitor-drawer-footer">
              <p class="monitor-drawer-readonly">{t("monitor.conversation.readOnly")}</p>
              <div class="monitor-drawer-actions">
                <For each={props.agents}>
                  {(agent) => (
                    <Button type="button" variant="ghost" onClick={() => props.onOpenThread(agent.id)}>
                      {agent.openThreadLabel}
                    </Button>
                  )}
                </For>
              </div>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
