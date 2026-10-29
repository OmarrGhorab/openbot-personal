import { isAgentTaskOpen } from "@openbot/team-client/agent-tasks";
import { Button, IconButton, Plus } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarWorkThreadsButton } from "../sidebar/SidebarWorkThreads";
import type { SidebarWorkThreads } from "../sidebar/sidebar-types";
import { AgentTaskMark, agentTaskStatus } from "./AgentTasks";

/** The most threads that show as chips. The rest are in the list that the count button opens. */
const VISIBLE_THREADS = 3;

/**
 * The threads (tasks) of the agent, in the chat header beside its name: a chip for each of the first open
 * threads, a plus that starts a new one, and a button with the count that opens the whole list with its
 * actions. A chip opens the thread in the side panel.
 */
export function ConversationThreadsStrip(props: { agentName: string; threads: SidebarWorkThreads }) {
  const { t } = useText();
  const open = () => props.threads.tasks.filter(isAgentTaskOpen);
  return (
    <div class="conversation-threads-strip no-drag">
      <For each={open().slice(0, VISIBLE_THREADS)} keyed={(task) => task.id}>
        {(task) => (
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
    </div>
  );
}
