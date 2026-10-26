import { ToolCallsDialog, type ToolCallsDialogCall } from "@openbot/ui/features/monitor/ToolCallsDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { writeClipboardText } from "../../clipboard";
import { buildMonitorAgentPopup, type MonitorAgentPopupModel, splitMonitorTaskTitle } from "./monitor-agent-popup";
import { useMonitor } from "./monitor-context";

/**
 * The tool calls of the agent's task: "View all" in the agent popup opens it. The calls come from the
 * live snapshot, so a running call updates. The input is copied as the snapshot holds it, already
 * redacted. "Open in thread" opens the agent's thread.
 */
export function MonitorToolCallsDialog() {
  const { t } = useText();
  const monitor = useMonitor();
  const model = createMemo(() => {
    const snapshot = monitor.state.snapshot;
    const agentId = monitor.state.toolCallsAgentId;
    return snapshot && agentId ? buildMonitorAgentPopup(snapshot, agentId) : null;
  });
  /** The last model, so the dialog keeps its content while it closes. */
  const [shown, setShown] = createSignal<MonitorAgentPopupModel | null>(null);
  createEffect(model, (next) => {
    if (next) setShown(next);
  });
  const [error, setError] = createSignal<string | null>(null);
  createEffect(
    () => monitor.state.toolCallsAgentId,
    () => {
      setError(null);
    },
  );

  const calls = createMemo((): ToolCallsDialogCall[] =>
    (shown()?.toolCalls ?? []).map((call) => ({
      id: call.id,
      tool: call.tool,
      argument: call.argument,
      input: call.input,
      output: call.output,
      status: call.status,
      startedAt: call.startedAt,
      durationMs: call.durationMs,
    })),
  );

  const description = () => {
    const current = shown();
    if (!current) return "";
    const count = current.toolCalls.length;
    const task = current.task ? splitMonitorTaskTitle(current.task.title).title : null;
    const parts = [current.agent.name, task, t("monitor.toolCalls.count", { count })];
    return parts.filter((part): part is string => part !== null).join(" · ");
  };

  async function copyInput(call: ToolCallsDialogCall) {
    if (call.input === null) return;
    try {
      await writeClipboardText(call.input);
      setError(null);
    } catch {
      setError(t("monitor.toolCalls.copyError"));
    }
  }

  return (
    <Show when={shown()}>
      {(current) => (
        <ToolCallsDialog
          open={model() !== null}
          onClose={() => monitor.closeToolCalls()}
          title={t("monitor.toolCalls.title")}
          description={description()}
          requestedBy={current().agent.name}
          calls={calls()}
          onOpenThread={() => monitor.openThread(current().agent.id)}
          onCopyInput={(call) => void copyInput(call)}
          error={error()}
        />
      )}
    </Show>
  );
}
