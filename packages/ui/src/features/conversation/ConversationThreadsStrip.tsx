import { isAgentTaskActive, isAgentTaskOpen } from "@openbot/team-client/agent-tasks";
import { Button, Clock3, IconButton, Plus, Popover, X } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarWorkThreadsButton } from "../sidebar/SidebarWorkThreads";
import type { SidebarWorkThreads } from "../sidebar/sidebar-types";
import { AgentTaskMark, agentTaskStatus } from "./AgentTasks";

/** The most threads that show as chips. The rest are in the list that the count button opens. */
const VISIBLE_THREADS = 3;

/**
 * The threads (tasks) of the agent, in the chat header beside its name: a chip for each of the first open threads, a plus that starts a new one, a button with
 * the count that opens the open threads with their actions, and History, which lists every thread, closed
 * ones too, newest first. A chip or a history row shows that thread in place of the chat.
 */
export function ConversationThreadsStrip(props: { agentName: string; threads: SidebarWorkThreads }) {
  const { t, format } = useText();
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const open = () => props.threads.tasks.filter(isAgentTaskOpen);
  const history = () => [...props.threads.tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return (
    <div class="conversation-threads-strip no-drag">
      <For each={open().slice(0, VISIBLE_THREADS)} keyed={(task) => task.id}>
        {(task) => (
          <span
            class="conversation-thread-chip-group"
            data-active={props.threads.activeTaskId === task().id ? "" : undefined}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="conversation-thread-chip"
              aria-pressed={props.threads.activeTaskId === task().id ? "true" : "false"}
              aria-label={t("conversation.tasks.chip.open", {
                title: task().title,
                status: agentTaskStatus(task(), t, props.threads.waitsForApproval?.(task())),
              })}
              onClick={() => props.threads.onOpen(task().id)}
            >
              <AgentTaskMark task={task()} decorative />
              <span class="conversation-thread-chip-title">{task().title}</span>
            </Button>
            <Show when={!isAgentTaskActive(task()) && props.threads.onClose}>
              {(close) => (
                <IconButton
                  label={t("sidebar.workThreads.close")}
                  variant="ghost"
                  size="icon-sm"
                  class="conversation-thread-chip-close"
                  onClick={() => close()(task().id)}
                >
                  <X aria-hidden="true" />
                </IconButton>
              )}
            </Show>
          </span>
        )}
      </For>
      <Show when={open().length > VISIBLE_THREADS}>
        <SidebarWorkThreadsButton agentName={props.agentName} threads={props.threads} placement="bottom-start" />
      </Show>
      <IconButton
        label={t("sidebar.workThreads.new")}
        variant="ghost"
        size="icon-sm"
        onClick={() => props.threads.onNew()}
      >
        <Plus aria-hidden="true" />
      </IconButton>
      <Popover.Root placement="bottom-start" gutter={8} open={historyOpen()} onOpenChange={setHistoryOpen}>
        <Popover.Trigger class="conversation-thread-history">
          <Clock3 aria-hidden="true" />
          <span>{t("conversation.threads.history")}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="ui-popover-menu-surface conversation-thread-history-popover">
            <Popover.Title class="conversation-thread-history-title">{t("conversation.threads.history")}</Popover.Title>
            <Show
              when={history().length > 0}
              fallback={<p class="conversation-thread-history-empty">{t("conversation.threads.historyEmpty")}</p>}
            >
              <ul class="conversation-thread-history-list">
                <For each={history()} keyed={(task) => task.id}>
                  {(task) => (
                    <li>
                      <Button
                        type="button"
                        variant="ghost"
                        class="conversation-thread-history-row"
                        aria-pressed={props.threads.activeTaskId === task().id ? "true" : "false"}
                        onClick={() => {
                          setHistoryOpen(false);
                          props.threads.onOpen(task().id);
                        }}
                      >
                        <AgentTaskMark task={task()} decorative />
                        <span class="conversation-thread-history-name">{task().title}</span>
                        <small class="conversation-thread-history-meta">
                          {task().state === "closed"
                            ? t("conversation.threads.closed")
                            : agentTaskStatus(task(), t, props.threads.waitsForApproval?.(task()))}
                          {" · "}
                          {format.date(new Date(task().updatedAt), {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
