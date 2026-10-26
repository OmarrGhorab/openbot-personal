/**
 * The tool calls of one task, in a modal: a filter, the list on the left and the detail of the
 * selected call on the right. The text must already be redacted: the Monitor data redacts the input
 * and the output before it leaves the main process. The dialog only shows them.
 *
 * Shared: it takes data and actions as props. Opening the thread and copying the input are the
 * caller's.
 */

import type { MonitorToolCallStatus } from "@openbot/contracts/ipc";
import { Button, Dialog, IconButton, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { MONITOR_TOOL_KIND_LABEL, MONITOR_TOOL_STATUS_LABEL, monitorToolKind } from "./monitor-status";
import { monitorDuration } from "./monitor-time";
import {
  filterMonitorToolCalls,
  MONITOR_TOOL_CALL_FILTERS,
  MONITOR_TOOL_OUTPUT_LINE_STEP,
  type MonitorToolCallFilter,
  monitorDiffLineKind,
} from "./monitor-tool-calls";
import { ToolCallRow } from "./ToolCallRow";

export interface ToolCallsDialogCall {
  id: string;
  /** The tool name as the provider reports it, such as `Edit` or `exec_command`. */
  tool: string;
  /** The short argument, redacted. */
  argument: string;
  /** The tool input, redacted. Null when the source keeps no input. */
  input: string | null;
  /** The tool output, redacted. Null when the source keeps no output. */
  output: string | null;
  status: MonitorToolCallStatus;
  startedAt: string;
  durationMs: number | null;
}

export interface ToolCallsDialogProps {
  open: boolean;
  /** Escape, a click on the dim layer and the close button call this. */
  onClose: () => void;
  /** The heading, such as "Tool calls". */
  title: string;
  /** The line under the heading, such as "Developer · Build pricing section · 12 calls". */
  description: string;
  /** The agent that made the calls, shown in the detail. */
  requestedBy: string;
  /** Newest first. */
  calls: readonly ToolCallsDialogCall[];
  onOpenThread: () => void;
  /** Copies the input of the call. The caller decides how. */
  onCopyInput: (call: ToolCallsDialogCall) => void;
  /** The last copy failed. */
  error?: string | null | undefined;
}

const FILTER_LABEL = {
  all: "monitor.toolCalls.filter.all",
  running: "monitor.toolCalls.filter.running",
  failed: "monitor.toolCalls.filter.failed",
} as const satisfies Record<MonitorToolCallFilter, string>;

export function ToolCallsDialog(props: ToolCallsDialogProps): JSX.Element {
  const { t, format } = useText();
  const duration = (ms: number | null) => (ms === null ? "—" : monitorDuration(ms, t, format));
  const [filter, setFilter] = createSignal<MonitorToolCallFilter>("all");
  const [picked, setPicked] = createSignal<string | null>(null);
  const [outputLimit, setOutputLimit] = createSignal(MONITOR_TOOL_OUTPUT_LINE_STEP);

  const visible = () => filterMonitorToolCalls(props.calls, filter());
  /** The picked call while the filter keeps it, else the first call of the filter. */
  const selected = () => visible().find((call) => call.id === picked()) ?? visible()[0] ?? null;
  const outputLines = () => {
    const output = selected()?.output;
    return output === null || output === undefined ? [] : output.split("\n");
  };
  const shownLines = () => outputLines().slice(0, outputLimit());
  const hiddenLines = () => outputLines().length - shownLines().length;

  // Another call: its output starts at the top, not at the limit of the last one.
  createEffect(
    () => selected()?.id,
    () => {
      setOutputLimit(MONITOR_TOOL_OUTPUT_LINE_STEP);
    },
  );

  const title = (tool: string) => {
    const kind = monitorToolKind(tool);
    return kind === "other" ? tool : t(MONITOR_TOOL_KIND_LABEL[kind]);
  };

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="monitor-popup-overlay">
          <Dialog.Content class="monitor-tool-calls">
            <header class="monitor-tool-calls-header">
              <div class="monitor-tool-calls-heading">
                <Dialog.Title class="monitor-tool-calls-title">{props.title}</Dialog.Title>
                <Dialog.Description class="monitor-tool-calls-description">{props.description}</Dialog.Description>
              </div>
              <div class="monitor-tool-calls-filters">
                <For each={MONITOR_TOOL_CALL_FILTERS}>
                  {(value) => (
                    <Button
                      type="button"
                      variant="ghost"
                      class="monitor-tool-calls-filter"
                      aria-pressed={filter() === value ? "true" : "false"}
                      onClick={() => setFilter(value)}
                    >
                      {t(FILTER_LABEL[value])}
                    </Button>
                  )}
                </For>
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

            <div class="monitor-tool-calls-body">
              <Show
                when={visible().length > 0}
                fallback={<p class="monitor-tool-calls-empty">{t("monitor.toolCalls.empty")}</p>}
              >
                <ul class="monitor-tool-calls-list" aria-label={t("monitor.toolCalls.list")}>
                  <For each={visible()} keyed={(call) => call.id}>
                    {(call) => (
                      <li>
                        <ToolCallRow
                          tool={call().tool}
                          argument={call().argument}
                          status={call().status}
                          durationMs={call().durationMs}
                          selected={selected()?.id === call().id}
                          onSelect={() => setPicked(call().id)}
                        />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <Show when={selected()}>
                {(call) => (
                  <section class="monitor-tool-call-detail" aria-label={t("monitor.toolCalls.detail.label")}>
                    <h3 class="monitor-tool-call-heading">
                      <span>{title(call().tool)}</span>
                      <span class="monitor-tool-call-status" data-status={call().status}>
                        {t(MONITOR_TOOL_STATUS_LABEL[call().status])}
                      </span>
                    </h3>
                    <dl class="monitor-tool-call-facts">
                      <div>
                        <dt>{t("monitor.toolCalls.detail.tool")}</dt>
                        <dd>{title(call().tool)}</dd>
                      </div>
                      <div>
                        <dt>{t("monitor.toolCalls.detail.argument")}</dt>
                        <dd>
                          <bdi>{call().argument}</bdi>
                        </dd>
                      </div>
                      <div>
                        <dt>{t("monitor.toolCalls.detail.started")}</dt>
                        <dd>
                          {format.date(new Date(call().startedAt), {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("monitor.toolCalls.detail.duration")}</dt>
                        <dd>{duration(call().durationMs)}</dd>
                      </div>
                      <div>
                        <dt>{t("monitor.toolCalls.detail.requestedBy")}</dt>
                        <dd>{props.requestedBy}</dd>
                      </div>
                    </dl>

                    <h4 class="monitor-tool-call-heading monitor-tool-call-subheading">
                      {t("monitor.toolCalls.input")}
                    </h4>
                    <Show
                      when={call().input !== null}
                      fallback={<p class="monitor-tool-calls-empty">{t("monitor.toolCalls.noInput")}</p>}
                    >
                      <pre class="monitor-tool-call-text">{call().input}</pre>
                    </Show>

                    <h4 class="monitor-tool-call-heading monitor-tool-call-subheading">
                      {t("monitor.toolCalls.output")}
                    </h4>
                    <Show
                      when={call().output !== null}
                      fallback={<p class="monitor-tool-calls-empty">{t("monitor.toolCalls.noOutput")}</p>}
                    >
                      <div class="monitor-tool-call-output">
                        <For each={shownLines()}>
                          {(line) => (
                            <div class="monitor-tool-call-line" data-kind={monitorDiffLineKind(line)}>
                              <bdi>{line || " "}</bdi>
                            </div>
                          )}
                        </For>
                        <Show when={hiddenLines() > 0}>
                          <Button
                            type="button"
                            variant="ghost"
                            class="monitor-tool-call-more"
                            onClick={() => setOutputLimit((limit) => limit + MONITOR_TOOL_OUTPUT_LINE_STEP)}
                          >
                            {t("monitor.toolCalls.showMore", {
                              count: Math.min(MONITOR_TOOL_OUTPUT_LINE_STEP, hiddenLines()),
                            })}
                          </Button>
                        </Show>
                      </div>
                    </Show>

                    <footer class="monitor-tool-call-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={call().input === null}
                        onClick={() => props.onCopyInput(call())}
                      >
                        {t("monitor.toolCalls.copyInput")}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => props.onOpenThread()}>
                        {t("monitor.toolCalls.openThread")}
                      </Button>
                    </footer>
                    <Show when={props.error}>{(error) => <p class="monitor-tool-calls-error">{error()}</p>}</Show>
                  </section>
                )}
              </Show>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
