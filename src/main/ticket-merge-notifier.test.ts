import type { DynamicIslandPresentation, TicketMergedEvent, TicketMergeNotice } from "@openbot/contracts/ipc";
import { TICKET_MERGE_TITLE_LIMIT } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { describe, expect, it, vi } from "vitest";
import {
  TICKET_MERGE_ISLAND_MS,
  TicketMergeNotifier,
  type TicketMergeNotifierDependencies,
  type TicketMergeSystemNotification,
} from "./ticket-merge-notifier";

const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

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
    mergedAt: "2026-10-30T03:00:00.000Z",
    ...overrides,
  };
}

function setup(overrides: Partial<TicketMergeNotifierDependencies> = {}) {
  const island: Array<{ presentation: DynamicIslandPresentation; durationMs: number }> = [];
  const toasts: TicketMergeNotice[] = [];
  const system: TicketMergeSystemNotification[] = [];
  const openedTickets: TicketMergeNotice[] = [];
  const openExternal = vi.fn(async (_url: string) => undefined);
  const notifier = new TicketMergeNotifier({
    notifyOnMerge: () => true,
    desktopNotifications: () => true,
    appIcon: () => ({ shape: "blob", color: "lavender", tile: "dark" }),
    showSystemNotification: (notification) => system.push(notification),
    showOnIsland: (presentation, durationMs) => island.push({ presentation, durationMs }),
    sendToWindow: (notice) => toasts.push(notice),
    openTicketInWindow: (notice) => openedTickets.push(notice),
    openExternal,
    translate: translateFor("en"),
    createId: () => "merge-1",
    ...overrides,
  });
  return { notifier, island, toasts, system, openedTickets, openExternal };
}

describe("TicketMergeNotifier", () => {
  it("shows the island, the toast and the system notification once per merge", () => {
    const { notifier, island, toasts, system } = setup();
    const notice = notifier.notifyTicketMerged(mergedEvent());
    expect(notice?.title).toBe("Add the export button");
    expect(island).toHaveLength(1);
    expect(island[0]?.durationMs).toBe(TICKET_MERGE_ISLAND_MS);
    expect(island[0]?.presentation).toMatchObject({
      mode: "merged",
      item: { noticeId: "merge-1", canOpenTicket: true, canOpenPullRequest: true, appIcon: { shape: "blob" } },
    });
    expect(toasts).toEqual([notice]);
    expect(system).toHaveLength(1);
    expect(system[0]?.title).toBe("Add the export button was merged");
    expect(system[0]?.body).toBe("The Reviewer merged PR #12. PASS · Quality 10/10 · CI green");
    expect(system[0]?.actions).toEqual(["View ticket", "View PR"]);
  });

  it("redacts a secret in the title on every surface", () => {
    const { notifier, island, toasts, system } = setup();
    notifier.notifyTicketMerged(mergedEvent({ ticketTitle: `Rotate ${SECRET} now` }));
    const shown = [
      JSON.stringify(island),
      JSON.stringify(toasts),
      JSON.stringify(system.map(({ title, body }) => ({ title, body }))),
    ].join("\n");
    expect(shown).not.toContain(SECRET);
    expect(toasts[0]?.title).toContain("[redacted]");
  });

  it("shortens a long title to the limit", () => {
    const { notifier, toasts } = setup();
    notifier.notifyTicketMerged(mergedEvent({ ticketTitle: "word ".repeat(100) }));
    const title = toasts[0]?.title ?? "";
    expect(Array.from(title).length).toBeLessThanOrEqual(TICKET_MERGE_TITLE_LIMIT);
    expect(title.endsWith("…")).toBe(true);
  });

  it("copies only the contract fields, so an extra field never reaches a surface", () => {
    const { notifier, toasts } = setup();
    const withExtra = { ...mergedEvent(), diff: `+ token = ${SECRET}`, log: "agent output" };
    // Not a literal, so the extra fields type-check, as an event from another sender would.
    const event: TicketMergedEvent = withExtra;
    notifier.notifyTicketMerged(event);
    expect(JSON.stringify(toasts)).not.toContain(SECRET);
    expect(toasts[0]).not.toHaveProperty("diff");
    expect(toasts[0]).not.toHaveProperty("log");
  });

  it("shows nothing when the setting is off or the event is not valid", () => {
    const off = setup({ notifyOnMerge: () => false });
    expect(off.notifier.notifyTicketMerged(mergedEvent())).toBeNull();
    expect(off.island).toHaveLength(0);
    expect(off.toasts).toHaveLength(0);
    const invalid = setup();
    expect(invalid.notifier.notifyTicketMerged(mergedEvent({ prUrl: "javascript:alert(1)" }))).toBeNull();
    expect(invalid.toasts).toHaveLength(0);
  });

  it("keeps the island and the toast when desktop notifications are off", () => {
    const { notifier, island, toasts, system } = setup({ desktopNotifications: () => false });
    notifier.notifyTicketMerged(mergedEvent());
    expect(island).toHaveLength(1);
    expect(toasts).toHaveLength(1);
    expect(system).toHaveLength(0);
  });

  it("opens the ticket in the window and the pull request in the browser", async () => {
    const { notifier, openedTickets, openExternal, system } = setup();
    notifier.notifyTicketMerged(mergedEvent());
    await notifier.open({ noticeId: "merge-1", target: "ticket" });
    expect(openedTickets.map((notice) => notice.ticketId)).toEqual(["ticket-1"]);
    await notifier.open({ noticeId: "merge-1", target: "pull-request" });
    expect(openExternal).toHaveBeenCalledWith("https://github.com/owner/repo/pull/12");
    await notifier.open({ noticeId: "unknown", target: "pull-request" });
    expect(openExternal).toHaveBeenCalledTimes(1);
    // A click on the system notification itself opens the ticket.
    system[0]?.onAction(null);
    expect(openedTickets).toHaveLength(2);
  });

  it("offers only what a merge can open", () => {
    const { notifier, system, island } = setup();
    notifier.notifyTicketMerged(mergedEvent({ ticketId: null, prUrl: null, prNumber: null }));
    expect(system[0]?.actions).toEqual([]);
    expect(system[0]?.body.startsWith("The Reviewer merged it.")).toBe(true);
    expect(island[0]?.presentation).toMatchObject({ item: { canOpenTicket: false, canOpenPullRequest: false } });
  });
});
