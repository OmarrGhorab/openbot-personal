import { MonitorTaskTable, type MonitorTaskTableRow } from "@openbot/ui/features/monitor/MonitorTaskTable";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import { useMonitor } from "./monitor-context";
import {
  buildMonitorTaskRows,
  countMonitorTaskRows,
  MONITOR_TASK_FILTER_LABEL,
  MONITOR_TASK_FILTERS,
  MONITOR_TASK_STATE_LABEL,
} from "./monitor-tasks";

/**
 * The Tasks view of the open channel: a chip per task status and a table of the tasks. A row opens
 * the agent popup of its agent. Like the feed, it shows the snapshot of the context, so Pause feed
 * stops it.
 */
export function MonitorTasks() {
  const { t } = useText();
  const monitor = useMonitor();
  const rows = createMemo(() => {
    const snapshot = monitor.filtered();
    return snapshot ? buildMonitorTaskRows(snapshot) : [];
  });
  const counts = createMemo(() => countMonitorTaskRows(rows()));
  const filters = createMemo(() =>
    MONITOR_TASK_FILTERS.map((value) => ({
      value,
      label: t(MONITOR_TASK_FILTER_LABEL[value]),
      count: counts()[value],
    })),
  );
  const shown = createMemo((): MonitorTaskTableRow[] => {
    const filter = monitor.state.taskFilter;
    return rows()
      .filter((row) => filter === "all" || row.group === filter)
      .map((row) => ({
        id: row.id,
        title: row.title,
        agent: row.agent
          ? {
              name: row.agent.name,
              avatar: {
                avatarSeed: row.agent.avatarSeed,
                avatarHue: row.agent.avatarHue,
                avatarUrl: row.agent.avatarUrl,
              },
            }
          : null,
        status: row.status,
        statusLabel: t(MONITOR_TASK_STATE_LABEL[row.state]),
        progress: row.progress,
        startedAt: row.startedAt,
        toolCalls: row.toolCalls,
      }));
  });

  return (
    <MonitorTaskTable
      rows={shown()}
      filters={filters()}
      filter={monitor.state.taskFilter}
      onFilter={(value) => {
        const filter = MONITOR_TASK_FILTERS.find((entry) => entry === value);
        if (filter) monitor.setTaskFilter(filter);
      }}
      onSelect={(id) => {
        const agentId = rows().find((row) => row.id === id)?.agent?.id;
        if (agentId) monitor.selectAgent(agentId);
      }}
      empty={rows().length === 0 ? t("monitor.tasks.empty") : t("monitor.tasks.emptyFilter")}
    />
  );
}
