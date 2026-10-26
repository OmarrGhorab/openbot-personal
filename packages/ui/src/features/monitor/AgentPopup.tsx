/**
 * The agent popup of the Monitor: what one agent does now, its newest tool calls and the agents it
 * talks to, in a modal. It is not the thread: "Open thread" goes there. The tool-call text must
 * already be redacted: the Monitor data redacts it before it leaves the main process.
 *
 * Shared: it takes data and actions as props. The Stop confirmation is the caller's: it decides
 * what Stop does.
 */

import type { MonitorStep, MonitorToolCallStatus } from "@openbot/contracts/ipc";
import { ArrowRight, Button, Dialog, IconButton, Play, Square, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { MONITOR_STATUS_MOOD, type MonitorStatus } from "./monitor-status";
import { ProgressBar } from "./ProgressBar";
import { StatusPill } from "./StatusPill";
import { ToolCallRow } from "./ToolCallRow";

/** The most tool calls the popup lists. "View all" shows the rest. */
export const AGENT_POPUP_TOOL_CALL_LIMIT = 5;

type AgentPopupAvatar = Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl">;

export interface AgentPopupTask {
  title: string;
  /** The full task text, when it says more than the title. */
  text?: string | null | undefined;
  step?: MonitorStep | null | undefined;
  /** Text after the percentage, such as "started 14m ago". */
  detail?: string | undefined;
  /** The colour of the progress bar. */
  status: MonitorStatus;
}

export interface AgentPopupToolCall {
  id: string;
  tool: string;
  /** Redacted. */
  argument: string;
  status: MonitorToolCallStatus;
  durationMs: number | null;
}

/** An agent this agent exchanged messages with. */
export interface AgentPopupContact {
  id: string;
  name: string;
  agent: AgentPopupAvatar;
  count: number;
}

export interface AgentPopupProps {
  open: boolean;
  /** Escape, a click on the dim layer and the close button call this. */
  onClose: () => void;
  agent: AgentPopupAvatar;
  name: string;
  status: MonitorStatus;
  /** Text in place of the status word, such as "Paused". */
  statusLabel?: string | undefined;
  /** The line under the name, such as "Channel lead · Claude Code". */
  meta?: string | undefined;
  /** Null: the agent works on no task. */
  task: AgentPopupTask | null;
  /** Newest first. The popup shows the first five, and highlights the one that runs. */
  toolCalls: readonly AgentPopupToolCall[];
  /** How many tool calls the task has in all. */
  toolCallCount: number;
  onViewAllToolCalls?: (() => void) | undefined;
  contacts: readonly AgentPopupContact[];
  onSelectContact?: ((agentId: string) => void) | undefined;
  onOpenThread: () => void;
  /** Shows "Stop task". The caller asks for confirmation. */
  onStopTask?: (() => void) | undefined;
  /** Shows "Resume task" for a stopped task that can continue. */
  onResumeTask?: (() => void) | undefined;
  resumePending?: boolean | undefined;
  /** The last action failed. */
  error?: string | null | undefined;
}

export function AgentPopup(props: AgentPopupProps): JSX.Element {
  const { t } = useText();
  const toolCalls = () => props.toolCalls.slice(0, AGENT_POPUP_TOOL_CALL_LIMIT);
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="monitor-popup-overlay">
          <Dialog.Content class="monitor-popup" data-status={props.status}>
            <header class="monitor-popup-header">
              <AgentAvatar class="monitor-popup-avatar" agent={props.agent} mood={MONITOR_STATUS_MOOD[props.status]} />
              <div class="monitor-popup-identity">
                <div class="monitor-popup-name-line">
                  <Dialog.Title class="monitor-popup-name">{props.name}</Dialog.Title>
                  <StatusPill status={props.status} label={props.statusLabel} />
                </div>
                <Show when={props.meta}>
                  <span class="monitor-popup-meta">{props.meta}</span>
                </Show>
                <Dialog.Description class="sr-only">{t("monitor.popup.description")}</Dialog.Description>
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

            <div class="monitor-popup-body">
              <section class="monitor-popup-section" aria-labelledby="monitor-popup-task">
                <h3 id="monitor-popup-task" class="monitor-popup-heading">
                  {t("monitor.popup.whatItDoes")}
                </h3>
                <Show
                  when={props.task}
                  fallback={
                    <div class="monitor-popup-task" data-empty="">
                      <p class="monitor-popup-task-title">{t("monitor.popup.noTask")}</p>
                      <p class="monitor-popup-task-text">{t("monitor.popup.noTaskDetail")}</p>
                    </div>
                  }
                >
                  {(task) => (
                    <div class="monitor-popup-task">
                      <p class="monitor-popup-task-title">
                        <bdi>{task().title}</bdi>
                      </p>
                      <Show when={task().text}>
                        {(text) => (
                          <p class="monitor-popup-task-text">
                            <bdi>{text()}</bdi>
                          </p>
                        )}
                      </Show>
                      <ProgressBar
                        value={task().step ? (task().step?.index ?? 0) / (task().step?.total ?? 1) : 0}
                        step={task().step}
                        detail={task().detail}
                        status={task().status}
                      />
                    </div>
                  )}
                </Show>
              </section>

              <section class="monitor-popup-section" aria-labelledby="monitor-popup-tools">
                <div class="monitor-popup-heading-row">
                  <h3 id="monitor-popup-tools" class="monitor-popup-heading">
                    {t("monitor.popup.toolCalls")}
                  </h3>
                  <Show when={props.toolCallCount > 0}>
                    <span class="monitor-popup-count">
                      {t("monitor.popup.toolCallCount", { count: props.toolCallCount })}
                      <Show when={props.onViewAllToolCalls}>
                        {(onViewAll) => (
                          <>
                            <span aria-hidden="true">{" · "}</span>
                            <Button
                              type="button"
                              variant="link"
                              size="xs"
                              class="monitor-popup-link"
                              onClick={() => onViewAll()()}
                            >
                              {t("monitor.popup.viewAll")}
                            </Button>
                          </>
                        )}
                      </Show>
                    </span>
                  </Show>
                </div>
                <Show
                  when={toolCalls().length > 0}
                  fallback={<p class="monitor-popup-empty">{t("monitor.popup.noToolCalls")}</p>}
                >
                  <ul class="monitor-popup-tools">
                    <For each={toolCalls()} keyed={(call) => call.id}>
                      {(call) => (
                        <li>
                          <ToolCallRow
                            tool={call().tool}
                            argument={call().argument}
                            status={call().status}
                            durationMs={call().durationMs}
                            selected={call().status === "running"}
                          />
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </section>

              <section class="monitor-popup-section" aria-labelledby="monitor-popup-contacts">
                <h3 id="monitor-popup-contacts" class="monitor-popup-heading">
                  {t("monitor.popup.talkingTo")}
                </h3>
                <Show
                  when={props.contacts.length > 0}
                  fallback={<p class="monitor-popup-empty">{t("monitor.popup.noContacts")}</p>}
                >
                  <ul class="monitor-popup-contacts">
                    <For each={props.contacts} keyed={(contact) => contact.id}>
                      {(contact) => {
                        const messages = () => t("monitor.canvas.messages", { count: contact().count });
                        const body = () => (
                          <>
                            <AgentAvatar class="monitor-popup-contact-avatar" agent={contact().agent} />
                            <span class="monitor-popup-contact-copy">
                              <span class="monitor-popup-contact-name">{contact().name}</span>
                              <span class="monitor-popup-contact-count">{messages()}</span>
                            </span>
                          </>
                        );
                        return (
                          <li>
                            <Show
                              when={props.onSelectContact}
                              fallback={<div class="monitor-popup-contact">{body()}</div>}
                            >
                              {(onSelect) => (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  class="monitor-popup-contact"
                                  aria-label={t("monitor.popup.openContact", {
                                    name: contact().name,
                                    messages: messages(),
                                  })}
                                  onClick={() => onSelect()(contact().id)}
                                >
                                  {body()}
                                </Button>
                              )}
                            </Show>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
              </section>
              <Show when={props.error}>
                {(error) => (
                  <p class="monitor-popup-error" role="alert">
                    {error()}
                  </p>
                )}
              </Show>
            </div>

            <footer class="monitor-popup-footer">
              <Button type="button" variant="secondary" onClick={() => props.onOpenThread()}>
                {t("monitor.popup.openThread")}
                <ArrowRight class="monitor-popup-arrow" aria-hidden="true" />
              </Button>
              <Show when={props.onResumeTask}>
                {(onResume) => (
                  <Button type="button" variant="outline" loading={props.resumePending} onClick={() => onResume()()}>
                    <Play aria-hidden="true" />
                    {t("monitor.popup.resumeTask")}
                  </Button>
                )}
              </Show>
              <Show when={props.onStopTask}>
                {(onStop) => (
                  <Button
                    type="button"
                    variant="destructive-ghost"
                    class="monitor-popup-stop"
                    onClick={() => onStop()()}
                  >
                    <Square aria-hidden="true" />
                    {t("monitor.popup.stopTask")}
                  </Button>
                )}
              </Show>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
