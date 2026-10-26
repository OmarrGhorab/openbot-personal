/**
 * The Tasks view of a Monitor channel: filter chips with a count each, and a table with the task,
 * its agent, status, progress, start and tool calls. A row with an agent opens that agent when
 * `onSelect` is set. The consumer resolves the rows and the chip counts; task titles and agent names
 * are user content.
 */

import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { Progress } from "../../progress";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { MonitorStatus } from "./monitor-status";
import { monitorAgo, monitorSince } from "./monitor-time";
import { StatusPill } from "./StatusPill";

export interface MonitorTaskTableRow {
  id: string;
  title: string;
  agent?: { name: string; avatar: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl"> } | null | undefined;
  status: MonitorStatus;
  /** The state word, such as "Queued". */
  statusLabel: string;
  /** From 0 to 1, or null when it is not known. */
  progress: number | null;
  /** When the task started, as an ISO time. */
  startedAt: string | null;
  toolCalls: number;
}

export interface MonitorTaskFilterChip {
  value: string;
  label: string;
  count: number;
}

export interface MonitorTaskTableProps {
  rows: readonly MonitorTaskTableRow[];
  filters: readonly MonitorTaskFilterChip[];
  filter: string;
  onFilter: (value: string) => void;
  /** Opens the agent of a row. Rows without an agent do not open. */
  onSelect?: ((id: string) => void) | undefined;
  /** The text when no row passes the filter. */
  empty: string;
  /** The clock for the start times. Defaults to the time of the render. */
  now?: Date | undefined;
  class?: string | undefined;
}

export function MonitorTaskTable(props: MonitorTaskTableProps): JSX.Element {
  const { t, format } = useText();
  const now = () => props.now ?? new Date();
  const started = (row: MonitorTaskTableRow) => {
    if (!row.startedAt) return "—";
    // A task that runs shows how long it runs; any other shows when it started.
    return row.status === "working" ? monitorSince(row.startedAt, now(), t) : monitorAgo(row.startedAt, now(), t);
  };
  return (
    <div class={["monitor-tasks", props.class]}>
      <div class="monitor-tasks-filters" role="group" aria-label={t("monitor.tasks.filterLabel")}>
        <For each={props.filters} keyed={(chip) => chip.value}>
          {(chip) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="monitor-tasks-chip"
              aria-pressed={props.filter === chip().value ? "true" : "false"}
              onClick={() => props.onFilter(chip().value)}
            >
              <span>{chip().label}</span>
              <span class="monitor-tasks-chip-count">{format.number(chip().count)}</span>
            </Button>
          )}
        </For>
      </div>
      <Show when={props.rows.length > 0} fallback={<p class="monitor-page-note">{props.empty}</p>}>
        <div class="monitor-tasks-frame">
          <table class="monitor-tasks-table">
            <thead>
              <tr>
                <th scope="col">{t("monitor.tasks.column.task")}</th>
                <th scope="col">{t("monitor.tasks.column.agent")}</th>
                <th scope="col">{t("monitor.tasks.column.status")}</th>
                <th scope="col">{t("monitor.tasks.column.progress")}</th>
                <th scope="col">{t("monitor.tasks.column.started")}</th>
                <th scope="col">{t("monitor.tasks.column.toolCalls")}</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.rows} keyed={(row) => row.id}>
                {(row) => (
                  <tr class="monitor-tasks-row" data-status={row().status} data-task={row().id}>
                    <td class="monitor-tasks-title">
                      <Show when={props.onSelect && row().agent}>
                        {(agent) => (
                          <Button
                            type="button"
                            variant="ghost"
                            class="monitor-select"
                            aria-label={t("monitor.tasks.open", { task: row().title, name: agent().name })}
                            onClick={() => props.onSelect?.(row().id)}
                          />
                        )}
                      </Show>
                      <span class="monitor-tasks-cell">
                        <bdi>{row().title}</bdi>
                      </span>
                    </td>
                    <td>
                      <Show when={row().agent} fallback={<span class="monitor-tasks-muted">—</span>}>
                        {(agent) => (
                          <span class="monitor-tasks-agent">
                            <AgentAvatar class="monitor-tasks-avatar" agent={agent().avatar} />
                            <bdi>{agent().name}</bdi>
                          </span>
                        )}
                      </Show>
                    </td>
                    <td>
                      <StatusPill status={row().status} label={row().statusLabel} />
                    </td>
                    <td>
                      <Show
                        when={row().progress !== null}
                        fallback={<span class="monitor-tasks-muted">—</span>}
                      >
                        <span class="monitor-progress monitor-tasks-progress" data-status={row().status}>
                          <Progress
                            class="monitor-progress-bar"
                            value={(row().progress ?? 0) * 100}
                            aria-label={t("monitor.progress.label")}
                          />
                          <span class="monitor-tasks-muted">{format.percent(row().progress ?? 0)}</span>
                        </span>
                      </Show>
                    </td>
                    <td class="monitor-tasks-muted">{started(row())}</td>
                    <td class="monitor-tasks-muted">{format.number(row().toolCalls)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
