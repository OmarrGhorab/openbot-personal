import { providerDisplayName } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { ConfirmDialog } from "@openbot/ui";
import { AgentPopup, type AgentPopupProps } from "@openbot/ui/features/monitor/AgentPopup";
import { monitorAgo } from "@openbot/ui/features/monitor/monitor-time";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, Show } from "solid-js";
import { buildMonitorAgentPopup, type MonitorAgentPopupModel, splitMonitorTaskTitle } from "./monitor-agent-popup";
import { useMonitor } from "./monitor-context";

/**
 * The agent popup of the Monitor: the selected agent of the open channel, with its task, tool calls
 * and contacts. Stop asks for confirmation first. There is no Pause: an agent task has no pause in
 * main, so the popup does not show one. A channel task that Stop held can resume.
 */
export function MonitorAgentPopup() {
  const { t } = useText();
  const monitor = useMonitor();
  const model = createMemo(() => {
    const snapshot = monitor.state.snapshot;
    const agentId = monitor.state.selectedAgentId;
    return snapshot && agentId ? buildMonitorAgentPopup(snapshot, agentId) : null;
  });
  /** The last model, so the popup keeps its content while it closes. */
  const [shown, setShown] = createSignal<MonitorAgentPopupModel | null>(null);
  createEffect(model, (next) => {
    if (next) setShown(next);
  });
  const [ui, setUi] = createStore<{
    confirming: boolean;
    resuming: boolean;
    error: AppTextKey | null;
    stopError: AppTextKey | null;
  }>({ confirming: false, resuming: false, error: null, stopError: null });
  // Another agent, or none: the last action and its confirmation belong to the previous one.
  createEffect(
    () => monitor.state.selectedAgentId,
    () => {
      setUi((draft) => {
        draft.confirming = false;
        draft.error = null;
        draft.stopError = null;
      });
    },
  );

  const popup = createMemo((): AgentPopupProps | null => {
    const current = shown();
    if (!current) return null;
    const { agent, task } = current;
    const role = agent.lead ? t("monitor.canvas.lead") : null;
    const provider = providerDisplayName(agent.provider);
    const held = current.resumable && agent.status !== "working";
    const startedAt = agent.startedAt ?? (task?.state === "running" ? task.updatedAt : null);
    const words = task ? splitMonitorTaskTitle(task.title) : null;
    return {
      open: model() !== null,
      onClose: () => monitor.clearAgent(),
      agent: { avatarSeed: agent.avatarSeed, avatarHue: agent.avatarHue, avatarUrl: agent.avatarUrl },
      name: agent.name,
      status: held ? "idle" : agent.status,
      statusLabel: held ? t("monitor.taskState.paused") : undefined,
      meta: role ? t("monitor.popup.meta", { role, provider }) : provider,
      task:
        task && words
          ? {
              title: words.title,
              text: words.text,
              step: held ? null : agent.step,
              detail:
                startedAt && !held
                  ? t("monitor.popup.started", { time: monitorAgo(startedAt, new Date(), t) })
                  : undefined,
              status: held ? "idle" : agent.status,
            }
          : null,
      toolCalls: current.toolCalls.map((call) => ({
        id: call.id,
        tool: call.tool,
        argument: call.argument,
        status: call.status,
        durationMs: call.durationMs,
      })),
      toolCallCount: task ? current.toolCalls.length : 0,
      contacts: current.contacts.map((contact) => ({
        id: contact.agent.id,
        name: contact.agent.name,
        agent: {
          avatarSeed: contact.agent.avatarSeed,
          avatarHue: contact.agent.avatarHue,
          avatarUrl: contact.agent.avatarUrl,
        },
        count: contact.count,
      })),
      onSelectContact: (agentId) => monitor.selectAgent(agentId),
      onOpenThread: () => monitor.openThread(agent.id),
      onStopTask: current.stoppable
        ? () =>
            setUi((draft) => {
              draft.confirming = true;
              draft.stopError = null;
            })
        : undefined,
      onResumeTask: current.resumable && task ? () => void resume() : undefined,
      resumePending: ui.resuming,
      error: ui.error ? t(ui.error) : null,
    };
  });

  async function resume() {
    const task = shown()?.task;
    if (!task || ui.resuming) return;
    setUi((draft) => {
      draft.resuming = true;
      draft.error = null;
    });
    try {
      await monitor.resumeTask(task);
    } catch {
      setUi((draft) => {
        draft.error = "monitor.popup.error.resume";
      });
    } finally {
      setUi((draft) => {
        draft.resuming = false;
      });
    }
  }

  async function stop() {
    const task = shown()?.task;
    if (!task) return;
    try {
      await monitor.stopTask(task);
      setUi((draft) => {
        draft.confirming = false;
      });
    } catch {
      setUi((draft) => {
        draft.stopError = "monitor.popup.error.stop";
      });
    }
  }

  const stopDescription = () => {
    const current = shown();
    if (!current?.task) return "";
    const name = current.agent.name;
    const task = splitMonitorTaskTitle(current.task.title).title;
    const step = current.agent.step;
    return step
      ? t("monitor.popup.stopDescriptionStep", { name, task, index: step.index, total: step.total })
      : t("monitor.popup.stopDescription", { name, task });
  };

  return (
    <>
      <Show when={popup()}>{(props) => <AgentPopup {...props()} />}</Show>
      <ConfirmDialog
        open={ui.confirming && model() !== null}
        onCancel={() =>
          setUi((draft) => {
            draft.confirming = false;
          })
        }
        onConfirm={stop}
        title={t("monitor.popup.stopTitle", { name: shown()?.agent.name ?? "" })}
        description={stopDescription()}
        confirmLabel={t("monitor.popup.stopTask")}
        pendingLabel={t("monitor.popup.stopping")}
        error={ui.stopError ? t(ui.stopError) : undefined}
        initialFocus="cancel"
      />
    </>
  );
}
