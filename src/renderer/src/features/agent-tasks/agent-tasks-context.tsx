import type { AgentEvent, AgentTask, AgentTasksSnapshot, ConversationSnapshot } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, createStore } from "solid-js";
import { actionToast } from "../../action-toast";
import { createScopeGuard } from "../../scope-lifetime";
import { createSimpleContext } from "../../simple-context";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { agentTasksPort } from "./agent-tasks-port";

type AgentTaskEvent = Extract<
  AgentEvent,
  { type: "agent-tasks-changed" | "agent-task-conversation" | "agent-task-conversation-delta" }
>;

interface AgentTasksState {
  /** The task list of each agent that loaded one, by agent id. */
  snapshots: Record<string, AgentTasksSnapshot>;
  /** The conversation of each task that loaded one, by task id. */
  conversations: Record<string, ConversationSnapshot>;
}

/**
 * A request to show one task, or a new task when `taskId` is null, in the side panel of the agent's
 * chat. The sidebar and a notification send it; the side panel of the chat listens. `sequence`
 * makes a second request for the same task a new value.
 */
interface AgentTaskOpenRequest {
  agentId: string;
  taskId: string | null;
  sequence: number;
}

/**
 * The tasks of each agent on this computer: their list, the conversation of each opened task, and the
 * task actions. Only the local host shows tasks in the chat; the Tasks page reads a joined server's
 * tasks through the `agent-tasks-v1` routes. Only the active agent's list loads; an
 * `agent-tasks-changed` event updates any agent.
 */
const AgentTasks = createSimpleContext({
  name: "AgentTasks",
  init: () => {
    const { activeServer } = useServers();
    const { activeAgentId, agentStatus } = useAgents();
    const scopeIsCurrent = createScopeGuard();
    const [state, setState] = createStore<AgentTasksState>({ snapshots: {}, conversations: {} });
    const listRequests = new Map<string, number>();
    const readRequests = new Map<string, number>();
    const [openRequest, setOpenRequest] = createSignal<AgentTaskOpenRequest | null>(null);
    let openSequence = 0;

    const available = () => {
      const server = activeServer();
      return !server || server.kind === "local";
    };

    function applySnapshot(snapshot: AgentTasksSnapshot): void {
      listRequests.set(snapshot.agentId, (listRequests.get(snapshot.agentId) ?? 0) + 1);
      setState((current) => {
        current.snapshots[snapshot.agentId] = snapshot;
      });
    }

    /** Keeps the newest conversation of a task. A delta raises the revision, so an older snapshot loses. */
    function applyConversation(taskId: string, snapshot: ConversationSnapshot): void {
      const stored = state.conversations[taskId];
      if (stored && snapshot.revision < stored.revision) return;
      setState((current) => {
        current.conversations[taskId] = snapshot;
      });
    }

    function applyDelta(event: Extract<AgentTaskEvent, { type: "agent-task-conversation-delta" }>): void {
      const stored = state.conversations[event.taskId];
      // A task that did not load its conversation reads it whole when it opens.
      if (!stored || event.revision <= stored.revision) return;
      setState((current) => {
        const conversation = current.conversations[event.taskId];
        if (!conversation) return;
        conversation.revision = event.revision;
        const existing = conversation.messages.find((message) => message.id === event.messageId);
        if (existing) {
          existing.text += event.delta;
          existing.status = "streaming";
          return;
        }
        conversation.messages.push({
          id: event.messageId,
          turnId: event.turnId,
          author: "assistant",
          text: event.delta,
          createdAt: event.createdAt,
          status: "streaming",
        });
      });
    }

    function applyEvent(event: AgentTaskEvent): void {
      if (event.type === "agent-tasks-changed") applySnapshot(event.snapshot);
      else if (event.type === "agent-task-conversation") applyConversation(event.taskId, event.snapshot);
      else applyDelta(event);
    }

    function loadTasks(agentId: string): void {
      const request = (listRequests.get(agentId) ?? 0) + 1;
      listRequests.set(agentId, request);
      void agentTasksPort()
        .agent.listTasks(agentId)
        .then((snapshot) => {
          if (!scopeIsCurrent() || listRequests.get(agentId) !== request) return;
          setState((current) => {
            current.snapshots[agentId] = snapshot;
          });
        })
        .catch((error) => {
          if (!scopeIsCurrent() || listRequests.get(agentId) !== request || agentId !== activeAgentId()) return;
          const { t, errorMessage } = currentText();
          actionToast.error(errorMessage(error, t("conversation.tasks.error.load")));
        });
    }

    createEffect(
      () => ({ agentId: activeAgentId(), agentPhase: agentStatus().phase, local: available() }),
      ({ agentId, local }) => {
        if (agentId && local) loadTasks(agentId);
      },
    );

    /** Reads the whole conversation of a task, for the task panel. */
    function openTask(agentId: string, taskId: string): void {
      const request = (readRequests.get(taskId) ?? 0) + 1;
      readRequests.set(taskId, request);
      void agentTasksPort()
        .agent.readTask({ agentId, taskId })
        .then((snapshot) => {
          if (!scopeIsCurrent() || readRequests.get(taskId) !== request) return;
          applyConversation(taskId, snapshot);
        })
        .catch((error) => {
          if (!scopeIsCurrent() || readRequests.get(taskId) !== request) return;
          const { t, errorMessage } = currentText();
          actionToast.error(errorMessage(error, t("conversation.tasks.error.read")));
        });
    }

    /** Adds a task that an action returned, so its panel shows before the list event arrives. */
    function rememberTask(task: AgentTask): void {
      setState((current) => {
        const snapshot = current.snapshots[task.agentId];
        if (!snapshot || snapshot.tasks.some((entry) => entry.id === task.id)) return;
        snapshot.tasks.unshift(task);
      });
    }

    async function runAction<Result>(action: () => Promise<Result>, fallback: AppTextKey): Promise<Result | null> {
      try {
        return await action();
      } catch (error) {
        if (!scopeIsCurrent()) return null;
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t(fallback)));
        return null;
      }
    }

    async function startTask(agentId: string, text: string): Promise<AgentTask | null> {
      const task = await runAction(
        () => agentTasksPort().agent.startTask({ agentId, text, clientMessageId: crypto.randomUUID() }),
        "conversation.tasks.error.start",
      );
      if (task && scopeIsCurrent()) rememberTask(task);
      return task;
    }

    async function runQueuedMessageAsTask(agentId: string, deliveryId: string): Promise<AgentTask | null> {
      const task = await runAction(
        () => agentTasksPort().agent.runQueuedMessageAsTask({ agentId, deliveryId }),
        "conversation.tasks.error.start",
      );
      if (task && scopeIsCurrent()) rememberTask(task);
      return task;
    }

    /** Steers the task's running turn, or queues the message in the task. */
    async function sendToTask(agentId: string, taskId: string, text: string): Promise<boolean> {
      const receipt = await runAction(
        () => agentTasksPort().agent.sendMessage({ agentId, taskId, text, clientMessageId: crypto.randomUUID() }),
        "conversation.tasks.error.send",
      );
      return receipt !== null;
    }

    function stopTask(agentId: string, taskId: string): void {
      void runAction(() => agentTasksPort().agent.stopTask({ agentId, taskId }), "conversation.tasks.error.stop");
    }

    function closeTask(agentId: string, taskId: string): void {
      void runAction(() => agentTasksPort().agent.closeTask({ agentId, taskId }), "conversation.tasks.error.close");
    }

    function reopenTask(agentId: string, taskId: string): void {
      void runAction(() => agentTasksPort().agent.reopenTask({ agentId, taskId }), "conversation.tasks.error.reopen");
    }

    function pauseTask(agentId: string, taskId: string): void {
      void runAction(() => agentTasksPort().agent.pauseTask({ agentId, taskId }), "conversation.tasks.error.pause");
    }

    function resumeTask(agentId: string, taskId: string): void {
      void runAction(() => agentTasksPort().agent.resumeTask({ agentId, taskId }), "conversation.tasks.error.resume");
    }

    /** Gives the task a new title. The returned task replaces the stored one before the list event arrives. */
    async function renameTask(agentId: string, taskId: string, title: string): Promise<boolean> {
      const trimmed = title.trim();
      if (!trimmed) return false;
      const task = await runAction(
        () => agentTasksPort().agent.renameTask({ agentId, taskId, title: trimmed }),
        "conversation.tasks.error.rename",
      );
      if (!task || !scopeIsCurrent()) return false;
      setState((current) => {
        const stored = current.snapshots[agentId]?.tasks.find((entry) => entry.id === taskId);
        if (stored) stored.title = task.title;
      });
      return true;
    }

    /** Deletes a closed task with its history. The backend refuses an open task. */
    async function deleteTask(agentId: string, taskId: string): Promise<boolean> {
      const deleted = await runAction(
        () =>
          agentTasksPort()
            .agent.deleteTask({ agentId, taskId })
            .then(() => true),
        "conversation.tasks.error.delete",
      );
      if (!deleted || !scopeIsCurrent()) return false;
      setState((current) => {
        const snapshot = current.snapshots[agentId];
        if (snapshot) snapshot.tasks = snapshot.tasks.filter((entry) => entry.id !== taskId);
        delete current.conversations[taskId];
      });
      return true;
    }

    /** Asks the agent's chat to show the task, or a new task, in its side panel. */
    function requestOpenTask(agentId: string, taskId: string | null): void {
      openSequence += 1;
      setOpenRequest({ agentId, taskId, sequence: openSequence });
    }

    /** The chat showed the requested task, so a chat that mounts later does not open it again. */
    function finishOpenRequest(sequence: number): void {
      if (openRequest()?.sequence === sequence) setOpenRequest(null);
    }

    return {
      available,
      snapshot: (agentId: string): AgentTasksSnapshot | undefined => state.snapshots[agentId],
      conversation: (taskId: string): ConversationSnapshot | undefined => state.conversations[taskId],
      applyEvent,
      openTask,
      startTask,
      runQueuedMessageAsTask,
      sendToTask,
      stopTask,
      closeTask,
      reopenTask,
      pauseTask,
      resumeTask,
      renameTask,
      deleteTask,
      openRequest,
      requestOpenTask,
      finishOpenRequest,
    };
  },
});

export const AgentTasksProvider = AgentTasks.provider;
export const useAgentTasks = AgentTasks.use;
