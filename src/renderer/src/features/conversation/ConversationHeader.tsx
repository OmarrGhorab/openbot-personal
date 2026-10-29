import { foreignProvider } from "@openbot/contracts/agent-providers";
import type { AgentModelId, AgentReasoningEffort } from "@openbot/contracts/ipc";
import { isAgentTaskActive } from "@openbot/team-client/agent-tasks";
import { reasoningLabel } from "@openbot/ui/components/ProviderModelPicker";
import { ConversationHeader as SharedConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import type { SidebarWorkThreads } from "@openbot/ui/features/sidebar/sidebar-types";
import { useConversationViewScope } from "./conversation-scope";

const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import { useText } from "@openbot/ui/text";

/** @internal Stable HMR boundary for conversation header. */
export function ConversationHeader() {
  const { t } = useText();
  const {
    actingBrowserControl,
    agentActivity,
    browserControlAgent,
    changeFastMode,
    channel,
    fastMode,
    props,
    runningTurnRuntime,
    selectAndConfirmModel,
    selectAndConfirmReasoning,
    setActiveRightPanel,
    settingsModel,
    settingsProvider,
    settingsReasoning,
    sidePanelOpen,
    toggleSidePanel,
    openTaskPanel,
    taskPanelOpen,
    taskPanelTaskId,
    threadCenter,
    setThreadCenter,
    closeSidePanelPane,
  } = useConversationViewScope();
  /** The threads of this agent, from the task controls of the chat: a chip opens the thread in the side panel. */
  const threads = (): SidebarWorkThreads | undefined => {
    const tasks = props.tasks;
    if (!tasks || !props.agent) return undefined;
    return {
      tasks: tasks.snapshot?.tasks ?? [],
      activeTaskId: taskPanelOpen() && threadCenter() ? taskPanelTaskId() : null,
      waitsForApproval: (task) => tasks.approval(task) !== undefined,
      onOpen: (taskId) => {
        tasks.onOpen(taskId);
        setThreadCenter(true);
        openTaskPanel(taskId);
      },
      onNew: () => {
        setThreadCenter(true);
        openTaskPanel(null);
      },
      onShowChat: () => {
        setThreadCenter(false);
        closeSidePanelPane("tasks");
      },
      onRename: tasks.onRename,
      onPause: tasks.onPause,
      onResume: tasks.onResume,
      onClose: (taskId) => {
        tasks.onClose(taskId);
        if (threadCenter() && taskPanelTaskId() === taskId) {
          setThreadCenter(false);
          closeSidePanelPane("tasks");
        }
      },
    };
  };
  const runningTasks = () => props.tasks?.snapshot?.tasks.filter(isAgentTaskActive).length ?? 0;
  const working = () => agentActivity() === "Working";
  /** The effort shows only where it differs, so a model change alone names only the models. */
  const runtimeLabel = (model: AgentModelId, effort: AgentReasoningEffort, otherEffort: AgentReasoningEffort) => {
    const name =
      props.modelOptions.find((option) => option.provider === settingsProvider() && option.id === model)?.name ?? model;
    return effort === otherEffort ? name : `${name} · ${reasoningLabel(effort, t)}`;
  };
  const pendingModel = () => {
    const running = runningTurnRuntime();
    if (!working() || !running) return undefined;
    const model = settingsModel();
    const effort = settingsReasoning();
    if (model === running.model && effort === running.reasoningEffort) return undefined;
    return {
      running: runtimeLabel(running.model, running.reasoningEffort, effort),
      next: runtimeLabel(model, effort, running.reasoningEffort),
    };
  };
  return (
    <SharedConversationHeader
      agent={props.agent}
      title={channel ? <channel.HeaderTitle onOpenSettings={() => setActiveRightPanel("settings")} /> : undefined}
      onSettingsIntent={() => void loadAgentSettingsPanel()}
      onOpenSettings={() => setActiveRightPanel("settings")}
      pendingModel={pendingModel()}
      threads={threads()}
      modelPicker={{
        provider: settingsProvider(),
        foreignProvider: props.agent ? foreignProvider(props.agent.provider) : undefined,
        value: settingsModel(),
        reasoningEffort: settingsReasoning(),
        modelOptions: props.modelOptions,
        agentStatus: props.agentStatus,
        runtimeStatuses: props.providerRuntimeStatuses,
        customProviders: props.customProviders,
        customAgents: props.customAgents,
        onDownloadProvider: props.onDownloadProvider,
        onCancelProviderDownload: props.onCancelProviderDownload,
        onConnectProvider: props.onConnectProvider,
        canConnectProvider: props.canConnectProvider,
        onManageProviders: props.onManageProviders,
        // A model or effort chosen during a turn applies from the next turn. A provider change waits.
        providerChangesDisabled: working(),
        disabledReason: working() ? t("conversation.header.providerBusy") : t("conversation.header.modelsUnavailable"),
        accountChoice: true,
        providerAccountId: props.agent?.providerAccountId,
        onChange: (model, provider, accountId) => void selectAndConfirmModel(model, provider, accountId),
        onReasoningEffortChange: (effort) => void selectAndConfirmReasoning(effort),
        // Codex only for now, and only on this computer: the Team API does not carry fast mode.
        fastMode: fastMode(),
        onFastModeChange:
          settingsProvider() === "codex" && props.server?.kind === "local"
            ? (next) => void changeFastMode(next)
            : undefined,
      }}
      remoteControl={
        props.remoteDesktopEnabled !== false && props.server?.kind === "remote"
          ? {
              enabled: Boolean(props.remoteDesktopSessionActive || props.server.state === "online"),
              active: Boolean(props.remoteDesktopSessionActive),
              visible: Boolean(props.remoteDesktopVisible),
              onOpen: (trigger) => {
                if (props.server) void props.onOpenRemoteDesktop(props.server.id, trigger);
              },
            }
          : undefined
      }
      sidePanel={
        channel?.readOnly()
          ? undefined
          : {
              open: sidePanelOpen(),
              actingAgentName: actingBrowserControl()
                ? (browserControlAgent()?.name ?? t("conversation.header.agentFallback"))
                : undefined,
              running: runningTasks(),
              onToggle: toggleSidePanel,
            }
      }
    />
  );
}
