/** Short times for the Monitor: how long ago, how long since, and how long a tool call took. */

import type { AppFormat, AppTranslate } from "@openbot/i18n";

function elapsedMinutes(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
}

/** "14m", "2h", "3d": how long a status has held, for a card footer. */
export function monitorSince(iso: string, now: Date, t: AppTranslate): string {
  const minutes = elapsedMinutes(iso, now);
  if (minutes < 1) return t("monitor.time.now");
  if (minutes < 60) return t("monitor.time.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("monitor.time.hours", { hours });
  return t("monitor.time.days", { days: Math.floor(hours / 24) });
}

/** "2m ago", "3h ago": when an event happened, for the feed. */
export function monitorAgo(iso: string, now: Date, t: AppTranslate): string {
  const minutes = elapsedMinutes(iso, now);
  if (minutes < 1) return t("monitor.time.justNow");
  if (minutes < 60) return t("monitor.time.minutesAgo", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("monitor.time.hoursAgo", { hours });
  return t("monitor.time.daysAgo", { days: Math.floor(hours / 24) });
}

/** "0.3 s", "4.2 s", "2m 5s": how long a tool call took. */
export function monitorDuration(ms: number, t: AppTranslate, format: AppFormat): string {
  if (ms < 60_000) {
    const seconds = format.number(ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return t("monitor.duration.seconds", { seconds });
  }
  const total = Math.round(ms / 1000);
  return t("monitor.duration.minutes", { minutes: Math.floor(total / 60), seconds: total % 60 });
}
