/**
 * The open work threads of one agent, under its row: one row for each open task with its state, and
 * a "New task" action. A task row opens the task in the side panel of the agent's chat. Its context
 * menu renames, pauses, resumes or closes the task. The closed tasks stay in the Tasks pane.
 */

import { isAgentTaskActive, isAgentTaskOpen } from "@openbot/team-client/agent-tasks";
import { buttonVariants, ContextMenu, Pause, Play, Plus, X } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentTaskMark, agentTaskStatus, isAgentTaskPaused } from "../conversation/AgentTasks";
import { EditIcon } from "./SidebarIcons";
import type { SidebarWorkThreads as SidebarWorkThreadsData } from "./sidebar-types";

export function SidebarWorkThreads(props: { agentName: string; threads: SidebarWorkThreadsData }) {
  const { t } = useText();
  /** The task whose title the rename field holds, with the draft title. */
  const [renaming, setRenaming] = createSignal<{ taskId: string; title: string } | null>(null);
  const openTasks = () => props.threads.tasks.filter(isAgentTaskOpen);
  const submitRename = async () => {
    const current = renaming();
    const rename = props.threads.onRename;
    const title = current?.title.trim();
    const task = current ? props.threads.tasks.find((entry) => entry.id === current.taskId) : undefined;
    if (!current || !title || !rename || title === task?.title) {
      setRenaming(null);
      return;
    }
    if (await rename(current.taskId, title)) setRenaming(null);
  };
  return (
    <ul class="sidebar-work-threads" aria-label={t("sidebar.workThreads.label", { name: props.agentName })}>
      <For each={openTasks()} keyed={(task) => task.id}>
        {(task) => (
          <li class="sidebar-work-thread">
            <Show
              when={renaming()?.taskId === task().id}
              fallback={
                <ContextMenu.Root modal={false}>
                  <ContextMenu.Trigger
                    as="button"
                    type="button"
                    class={[
                      buttonVariants({ variant: "ghost" }),
                      "sidebar-work-thread-row",
                      { "sidebar-work-thread-row-active": props.threads.activeTaskId === task().id },
                    ]}
                    aria-current={props.threads.activeTaskId === task().id ? "true" : undefined}
                    aria-label={t("conversation.tasks.chip.open", {
                      title: task().title,
                      status: agentTaskStatus(task(), t, props.threads.waitsForApproval?.(task())),
                    })}
                    onClick={() => props.threads.onOpen(task().id)}
                  >
                    <AgentTaskMark task={task()} decorative />
                    <span class="sidebar-work-thread-title">{task().title}</span>
                    <small class="sidebar-work-thread-status">
                      {agentTaskStatus(task(), t, props.threads.waitsForApproval?.(task()))}
                    </small>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content class="agent-context-menu" aria-label={t("sidebar.workThreads.menu")}>
                      <Show when={props.threads.onRename}>
                        <ContextMenu.Item
                          onSelectAfterClose={() => setRenaming({ taskId: task().id, title: task().title })}
                        >
                          <EditIcon />
                          <span>{t("sidebar.workThreads.rename")}</span>
                        </ContextMenu.Item>
                      </Show>
                      <Show
                        when={isAgentTaskPaused(task())}
                        fallback={
                          <Show when={props.threads.onPause}>
                            {(pause) => (
                              <ContextMenu.Item onSelect={() => pause()(task().id)}>
                                <Pause class="agent-context-icon size-4" aria-hidden="true" />
                                <span>{t("sidebar.workThreads.pause")}</span>
                              </ContextMenu.Item>
                            )}
                          </Show>
                        }
                      >
                        <Show when={props.threads.onResume}>
                          {(resume) => (
                            <ContextMenu.Item onSelect={() => resume()(task().id)}>
                              <Play class="agent-context-icon size-4" aria-hidden="true" />
                              <span>{t("sidebar.workThreads.resume")}</span>
                            </ContextMenu.Item>
                          )}
                        </Show>
                      </Show>
                      <Show when={!isAgentTaskActive(task()) && props.threads.onClose}>
                        {(close) => (
                          <ContextMenu.Item onSelect={() => close()(task().id)}>
                            <X class="agent-context-icon size-4" aria-hidden="true" />
                            <span>{t("sidebar.workThreads.close")}</span>
                          </ContextMenu.Item>
                        )}
                      </Show>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              }
            >
              <form
                class="sidebar-work-thread-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitRename();
                }}
              >
                <input
                  class="sidebar-work-thread-rename-input"
                  aria-label={t("sidebar.workThreads.renameLabel")}
                  value={renaming()?.title ?? ""}
                  maxLength={160}
                  ref={(element) => queueMicrotask(() => element.select())}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setRenaming((current) => (current ? { ...current, title: value } : current));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => void submitRename()}
                />
              </form>
            </Show>
          </li>
        )}
      </For>
      <li class="sidebar-work-thread">
        <button
          type="button"
          class={[buttonVariants({ variant: "ghost" }), "sidebar-work-thread-row", "sidebar-work-thread-new"]}
          onClick={() => props.threads.onNew()}
        >
          <Plus class="sidebar-work-thread-icon" aria-hidden="true" />
          <span class="sidebar-work-thread-title">{t("sidebar.workThreads.new")}</span>
        </button>
      </li>
    </ul>
  );
}
