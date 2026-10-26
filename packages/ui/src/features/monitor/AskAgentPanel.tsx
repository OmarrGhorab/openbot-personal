/**
 * The "Ask an agent about this channel" panel of the Monitor: a floating panel over the bottom of the
 * canvas, with suggestions, the question, the answer and the agents the answer names. It takes data
 * and actions as props. The answer text must already be redacted: the caller sends the redacted
 * snapshot and shows only what the agent replies.
 */

import type { MonitorAgentStatus } from "@openbot/contracts/ipc";
import { Button, IconButton, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { Input } from "../../form";
import { useText } from "../../text";
import { MONITOR_STATUS_LABEL } from "./monitor-status";
import { StatusDot } from "./StatusPill";

export interface AskAgentSuggestion {
  id: string;
  label: string;
}

/** An agent the answer names. A chip opens its agent popup. */
export interface AskAgentSource {
  agentId: string;
  name: string;
  status: MonitorAgentStatus;
}

export type AskAgentMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "answer";
      text: string;
      /** `streaming` while the reply grows, `stopped` when the user stopped reading it. */
      status: "streaming" | "completed" | "failed" | "stopped";
      sources: readonly AskAgentSource[];
    }
  | { id: string; role: "error"; text: string };

export interface AskAgentPanelProps {
  open: boolean;
  onClose: () => void;
  channelName: string;
  suggestions: readonly AskAgentSuggestion[];
  messages: readonly AskAgentMessage[];
  /** The question box value. */
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  onSuggest: (label: string) => void;
  /** Stops reading the reply. The agent keeps its turn. Shown while the reply streams. */
  onStop: () => void;
  onOpenAgent: (agentId: string) => void;
  /** True while a question waits for the reply. */
  busy: boolean;
}

export function AskAgentPanel(props: AskAgentPanelProps): JSX.Element {
  const { t } = useText();
  const streaming = () => props.messages.some((message) => message.role === "answer" && message.status === "streaming");
  return (
    <Show when={props.open}>
      <section class="monitor-ask" aria-label={t("monitor.ask.label", { name: props.channelName })}>
        <header class="monitor-ask-header">
          <span class="monitor-ask-title">{t("monitor.ask.title", { name: props.channelName })}</span>
          <IconButton
            variant="ghost"
            class="monitor-ask-close"
            label={t("common.close")}
            onClick={() => props.onClose()}
          >
            <X aria-hidden="true" />
          </IconButton>
        </header>

        <div class="monitor-ask-body" aria-live="polite">
          <Show when={props.messages.length === 0}>
            <ul class="monitor-ask-suggestions" aria-label={t("monitor.ask.suggestions")}>
              <For each={props.suggestions}>
                {(suggestion) => (
                  <li>
                    <Button
                      type="button"
                      variant="outline"
                      class="monitor-ask-suggestion"
                      onClick={() => props.onSuggest(suggestion.label)}
                    >
                      {suggestion.label}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <For each={props.messages}>
            {(message) => (
              <Show
                when={message.role === "user"}
                fallback={
                  <Show when={message.role === "answer"} fallback={<p class="monitor-ask-error">{message.text}</p>}>
                    <article
                      class="monitor-ask-answer"
                      data-status={message.role === "answer" ? message.status : undefined}
                    >
                      <p class="monitor-ask-answer-text">
                        <bdi>{message.role === "answer" ? message.text : ""}</bdi>
                      </p>
                      <Show when={message.role === "answer" && message.status === "streaming" && message.text === ""}>
                        <p class="monitor-ask-pending">{t("monitor.ask.thinking")}</p>
                      </Show>
                      <Show when={message.role === "answer" && message.status === "failed"}>
                        <p class="monitor-ask-error">{t("monitor.ask.failed")}</p>
                      </Show>
                      <Show when={message.role === "answer" && message.status === "stopped"}>
                        <p class="monitor-ask-pending">{t("monitor.ask.stopped")}</p>
                      </Show>
                      <Show when={message.role === "answer" && message.sources.length > 0}>
                        <ul class="monitor-ask-sources" aria-label={t("monitor.ask.sources")}>
                          <For each={message.role === "answer" ? message.sources : []}>
                            {(source) => (
                              <li>
                                <Button
                                  type="button"
                                  variant="outline"
                                  class="monitor-ask-source"
                                  onClick={() => props.onOpenAgent(source.agentId)}
                                >
                                  <StatusDot
                                    status={
                                      source.status === "working"
                                        ? "working"
                                        : source.status === "waiting"
                                          ? "waiting"
                                          : source.status === "error"
                                            ? "error"
                                            : "done"
                                    }
                                  />
                                  {source.name}
                                  <span class="monitor-ask-source-status">
                                    {t(MONITOR_STATUS_LABEL[source.status])}
                                  </span>
                                </Button>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </article>
                  </Show>
                }
              >
                <p class="monitor-ask-question">
                  <bdi>{message.role === "user" ? message.text : ""}</bdi>
                </p>
              </Show>
            )}
          </For>
        </div>

        <form
          class="monitor-ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSend();
          }}
        >
          <Input
            class="monitor-ask-input"
            aria-label={t("monitor.ask.placeholder")}
            placeholder={t("monitor.ask.placeholder")}
            value={props.draft}
            disabled={props.busy}
            onValueChange={(value) => props.onDraft(value)}
          />
          <Show
            when={streaming()}
            fallback={
              <Button type="submit" variant="outline" disabled={props.busy || props.draft.trim() === ""}>
                {t("monitor.ask.send")}
              </Button>
            }
          >
            <Button type="button" variant="outline" onClick={() => props.onStop()}>
              {t("monitor.ask.stop")}
            </Button>
          </Show>
        </form>
      </section>
    </Show>
  );
}
