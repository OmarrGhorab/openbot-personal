// Checks the "ticket merged" notification (#199) end to end, in two parts.
//
// Part 1 (always): drives the main-process notifier with recording surfaces in place of Electron:
// - one merge shows the island (merged mode, with the App icon), the in-app toast and the system
//   notification, with "View ticket" and "View PR";
// - the title is redacted and shortened, and no extra field (diff, log) reaches any surface;
// - "Tell me when it merges" off shows nothing; desktop notifications off keeps the island and the toast;
// - a change of the App icon in Settings › Appearance shows on the next merge;
// - "View ticket" asks the window to open the ticket; "View PR" opens only the https URL main holds.
//
// Part 2 (when one dev app runs for this worktree): connects to its window and checks the IPC
// wiring and the trust boundary: the window has the merge events, "View PR" for an unknown notice
// opens nothing, and a request that is not valid is refused in main.
//
// Writes .openbot-build/ticket-merge-notification/report.json. Changes nothing in the app.
// Run with `bun scripts/ticket-merge-notification-e2e.ts`.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AppLogoColorPreference,
  DynamicIslandPresentation,
  OpenBotDesktopApi,
  TicketMergedEvent,
  TicketMergeNotice,
} from "@openbot/contracts/ipc";
import { TICKET_MERGE_TITLE_LIMIT } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { TicketMergeNotifier, type TicketMergeSystemNotification } from "../src/main/ticket-merge-notifier";
import { connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/ticket-merge-notification");
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const logger = createOpenBotLogger("ticket-merge-notification-e2e");
interface Report {
  notifier?: { island: number; toasts: number; system: number; passed: boolean };
  devApp?: string | { events: boolean; refused: boolean; passed: boolean };
}
const report: Report = {};

function mergedEvent(overrides: Partial<TicketMergedEvent> = {}): TicketMergedEvent {
  return {
    ticketId: "ticket-1",
    ticketKey: "PROJ-482",
    ticketTitle: "Add the export button",
    repo: "owner/repo",
    prNumber: 12,
    prUrl: "https://github.com/owner/repo/pull/12",
    reviewer: "PASS",
    qualityScore: 10,
    ci: "green",
    mergedAt: new Date().toISOString(),
    ...overrides,
  };
}

// Part 1: the notifier with recording surfaces.
{
  let notifyOnMerge = true;
  let desktopNotifications = true;
  let appIcon: AppLogoColorPreference = { shape: "blob", color: "lavender", tile: "dark" };
  const island: DynamicIslandPresentation[] = [];
  const toasts: TicketMergeNotice[] = [];
  const system: TicketMergeSystemNotification[] = [];
  const openedTickets: string[] = [];
  const openedUrls: string[] = [];
  let sequence = 0;
  const notifier = new TicketMergeNotifier({
    notifyOnMerge: () => notifyOnMerge,
    desktopNotifications: () => desktopNotifications,
    appIcon: () => appIcon,
    showSystemNotification: (notification) => system.push(notification),
    showOnIsland: (presentation) => island.push(presentation),
    sendToWindow: (notice) => toasts.push(notice),
    openTicketInWindow: (notice) => openedTickets.push(notice.ticketId ?? ""),
    openExternal: async (url) => {
      openedUrls.push(url);
    },
    translate: translateFor("en"),
    createId: () => `merge-${++sequence}`,
  });

  const first = notifier.notifyTicketMerged(mergedEvent());
  assert.ok(first, "A valid merge shows a notice.");
  assert.equal(island.length, 1);
  assert.equal(island[0]?.mode, "merged");
  assert.equal(toasts.length, 1);
  assert.equal(system.length, 1);
  assert.deepEqual(system[0]?.actions, ["View ticket", "View PR"]);
  assert.match(system[0]?.body ?? "", /PASS · Quality 10\/10 · CI green/u);

  const withExtra = { ...mergedEvent({ ticketTitle: `Rotate ${SECRET} ${"long ".repeat(60)}` }), diff: SECRET };
  // Not a literal, so the extra `diff` field type-checks, as an event from another sender would.
  const extra: TicketMergedEvent = withExtra;
  const redacted = notifier.notifyTicketMerged(extra);
  assert.ok(redacted);
  const shown = JSON.stringify({ island, toasts, system: system.map(({ title, body }) => ({ title, body })) });
  assert.ok(!shown.includes(SECRET), "No surface shows the secret.");
  assert.ok(Array.from(redacted.title).length <= TICKET_MERGE_TITLE_LIMIT, "The title is shortened.");

  notifyOnMerge = false;
  assert.equal(notifier.notifyTicketMerged(mergedEvent()), null, "The setting off shows nothing.");
  notifyOnMerge = true;
  desktopNotifications = false;
  const systemBefore = system.length;
  notifier.notifyTicketMerged(mergedEvent());
  assert.equal(system.length, systemBefore, "Desktop notifications off: no system notification.");
  desktopNotifications = true;

  appIcon = { shape: "whale", color: "blue", tile: "tint" };
  notifier.notifyTicketMerged(mergedEvent());
  const latest = island.at(-1);
  assert.ok(latest?.mode === "merged");
  assert.deepEqual(latest.item.appIcon, appIcon, "The island shows the App icon from Settings.");
  assert.deepEqual(system.at(-1)?.appIcon, appIcon, "The system notification shows the App icon from Settings.");

  await notifier.open({ noticeId: first.id, target: "ticket" });
  await notifier.open({ noticeId: first.id, target: "pull-request" });
  await notifier.open({ noticeId: "unknown", target: "pull-request" });
  assert.deepEqual(openedTickets, ["ticket-1"]);
  assert.deepEqual(openedUrls, ["https://github.com/owner/repo/pull/12"]);
  assert.equal(notifier.notifyTicketMerged(mergedEvent({ prUrl: "javascript:alert(1)" })), null);

  report.notifier = { island: island.length, toasts: toasts.length, system: system.length, passed: true };
  logger.info("Part 1 passed: the notifier.");
}

// Part 2: the IPC wiring of a running dev app, when there is one.
const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
const instance = instances.length === 1 ? instances[0] : undefined;
if (!instance) {
  report.devApp = "skipped: start one dev app for this worktree to check the IPC wiring";
  logger.info("Part 2 skipped: no single dev app for this worktree.");
} else {
  const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
    expectedRendererPort: instance.rendererPort,
    ownerPid: instance.pid,
  });
  const page = session.page;
  const wiring = await page.evaluate(async () => {
    const notifications = window.openbot.notifications;
    const events =
      typeof notifications.onTicketMerged === "function" && typeof notifications.onTicketMergeOpened === "function";
    // An unknown notice opens nothing and resolves.
    await notifications.openTicketMerge({ noticeId: "e2e-unknown", target: "pull-request" });
    let refused = false;
    try {
      // An empty notice id has the right type, but main's parser refuses it.
      await notifications.openTicketMerge({ noticeId: "", target: "pull-request" });
    } catch {
      refused = true;
    }
    return { events, refused };
  });
  assert.ok(wiring.events, "The window has the merge events.");
  assert.ok(wiring.refused, "Main refuses a request that is not valid.");
  report.devApp = { ...wiring, passed: true };
  logger.info("Part 2 passed: the IPC wiring.");
}

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
logger.info(`Wrote ${resolve(OUT, "report.json")}`);
process.exit(0);
