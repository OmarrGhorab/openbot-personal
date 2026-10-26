import { FeedItem, type FeedItemProps } from "@openbot/ui/features/monitor/FeedItem";
import {
  MONITOR_TOOL_KIND_LABEL,
  MONITOR_TOOL_STATUS_LABEL,
  monitorToolKind,
} from "@openbot/ui/features/monitor/monitor-status";
import { monitorDuration } from "@openbot/ui/features/monitor/monitor-time";
import { useText } from "@openbot/ui/text";
import { createMemo, For, Show } from "solid-js";
import { useMonitor } from "./monitor-context";
import {
  buildMonitorFeed,
  MONITOR_FEED_AUTHOR,
  MONITOR_FEED_STATUS_VERB,
  MONITOR_FEED_TASK_VERB,
  type MonitorFeedEntry,
} from "./monitor-feed";

/**
 * The Feed view of the open channel: every event of the snapshot, newest first. It shows the
 * snapshot of the context, so Pause feed stops it as it stops the canvas.
 */
export function MonitorFeed() {
  const { t, format } = useText();
  const monitor = useMonitor();
  const entries = createMemo(() => {
    const snapshot = monitor.filtered();
    return snapshot ? buildMonitorFeed(snapshot) : [];
  });

  const toolTitle = (tool: string | null) => {
    if (tool === null) return undefined;
    const kind = monitorToolKind(tool);
    return kind === "other" ? tool : t(MONITOR_TOOL_KIND_LABEL[kind]);
  };

  const item = (entry: MonitorFeedEntry): FeedItemProps => {
    const actor = entry.agent?.name ?? t("monitor.feed.author.unknown");
    const shared = {
      agent: entry.agent ?? undefined,
      at: entry.at,
      status: entry.agent?.status,
      tone: entry.tone,
    };
    switch (entry.kind) {
      case "message":
        return {
          ...shared,
          actor: entry.agent?.name ?? t(MONITOR_FEED_AUTHOR[entry.authorKind]),
          verb: t("monitor.feed.posted"),
          text: entry.preview,
        };
      case "task":
        return {
          ...shared,
          actor: entry.agent?.name ?? t("monitor.feed.author.coordinator"),
          verb: t(MONITOR_FEED_TASK_VERB[entry.state]),
          target: entry.title ?? undefined,
          text: entry.error,
          progress: entry.step ? { value: entry.step.index / entry.step.total, step: entry.step } : undefined,
        };
      case "tool-call": {
        const status = t(MONITOR_TOOL_STATUS_LABEL[entry.status]);
        const outcome =
          entry.durationMs === null
            ? status
            : t("monitor.tool.outcome", { status, duration: monitorDuration(entry.durationMs, t, format) });
        return {
          ...shared,
          actor,
          verb: t("monitor.feed.ranTool"),
          target: toolTitle(entry.tool),
          text: entry.argument ? t("monitor.feed.toolText", { argument: entry.argument, outcome }) : outcome,
        };
      }
      case "agent-message":
        return {
          ...shared,
          actor,
          verb: t("monitor.feed.messaged"),
          target: entry.to?.name ?? t("monitor.feed.author.unknown"),
        };
      case "agent-status":
        return { ...shared, actor, verb: t(MONITOR_FEED_STATUS_VERB[entry.status]), text: entry.error };
      default:
        return entry satisfies never;
    }
  };

  return (
    <section class="monitor-feed" aria-label={t("monitor.feed.title")}>
      <header class="monitor-feed-header">
        <h2 class="monitor-feed-title">{t("monitor.feed.title")}</h2>
        <span class="monitor-feed-summary">{t("monitor.feed.summary", { count: entries().length })}</span>
      </header>
      <Show when={entries().length > 0} fallback={<p class="monitor-page-note">{t("monitor.feed.empty")}</p>}>
        <ol class="monitor-feed-list">
          <For each={entries()} keyed={(entry) => entry.id}>
            {(entry) => (
              <li data-monitor-event={entry().id}>
                <FeedItem {...item(entry())} />
              </li>
            )}
          </For>
        </ol>
      </Show>
    </section>
  );
}
