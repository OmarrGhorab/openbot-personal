import {
  type AppLogoColorPreference,
  type DynamicIslandPresentation,
  isTicketMergedEvent,
  shortenTicketMergeTitle,
  type TicketMergedEvent,
  type TicketMergeNotice,
  type TicketMergeOpenRequest,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { redactText } from "@openbot/logging";

/** How long the island shows a merge before it goes back to what the window published. */
export const TICKET_MERGE_ISLAND_MS = 6_000;

/** Enough notices for "View ticket" on every recent merge; older ones are forgotten. */
const NOTICE_LIMIT = 50;

/** The system notification this notifier shows. Electron's `Notification` in the app, a fake in a script. */
export interface TicketMergeSystemNotification {
  title: string;
  body: string;
  /** The App icon from Settings › Appearance, already drawn. Undefined keeps the system default. */
  icon: unknown;
  /** Button labels, in order. macOS shows them; other systems show a click only. */
  actions: readonly string[];
  /** Called with the button index, or null for a click on the notification itself. */
  onAction: (index: number | null) => void;
}

export interface TicketMergeNotifierDependencies {
  /**
   * The "Tell me when it merges" setting. It belongs to the Autopilot settings (#195):
   * `() => services.ravenAutopilot.current().notifyOnMerge`. On by default.
   */
  notifyOnMerge: () => boolean;
  /** The desktop notification switch in Settings › Notifications. Off keeps the island and the toast. */
  desktopNotifications: () => boolean;
  /** Settings › Appearance: App icon (mascot), Logo color and App icon tile. */
  appIcon: () => AppLogoColorPreference;
  /** Draws the App icon for the system notification, or returns undefined to keep the default. */
  drawAppIcon: (preference: AppLogoColorPreference) => unknown;
  showSystemNotification: (notification: TicketMergeSystemNotification) => void;
  /** Shows the merge on the island for a few seconds, over what the window published. */
  showOnIsland: (presentation: DynamicIslandPresentation, durationMs: number) => void;
  /** Sends the notice to the main window, which shows the in-app toast. */
  sendToWindow: (notice: TicketMergeNotice) => void;
  /** Brings the main window up and asks it to open the ticket on the board. */
  openTicketInWindow: (notice: TicketMergeNotice) => void;
  openExternal: (url: string) => Promise<void>;
  translate: AppTranslate;
  createId?: () => string;
  redact?: (text: string) => string;
  reportError?: (message: string, error: unknown) => void;
}

/**
 * Tells the user when the Reviewer merges a ticket: the island, a system notification and the
 * in-app toast. Every surface shows the App icon from Settings › Appearance, so a change there
 * shows on the next merge.
 *
 * What it shows is built from structured facts only (title, PR number, PASS, Quality, CI). The
 * title is redacted and shortened, and no diff, log or agent text is ever read, so a notification
 * cannot show a secret or a full diff.
 */
export class TicketMergeNotifier {
  readonly #deps: TicketMergeNotifierDependencies;
  readonly #notices = new Map<string, TicketMergeNotice>();
  #sequence = 0;

  constructor(deps: TicketMergeNotifierDependencies) {
    this.#deps = deps;
  }

  /**
   * The one entry point. The Reviewer (#198) calls it once per merge, after the ticket moves to
   * Done: `ravenTeam.onTicketMerged((event) => ticketMerge.notifyTicketMerged(event))`.
   * Returns the notice it showed, or null when the setting is off or the event is not valid.
   */
  notifyTicketMerged(event: TicketMergedEvent): TicketMergeNotice | null {
    if (!this.#deps.notifyOnMerge()) return null;
    if (!isTicketMergedEvent(event)) {
      this.#deps.reportError?.("Ignored a ticket merged event that is not valid.", null);
      return null;
    }
    const notice = this.#notice(event);
    this.#remember(notice);
    const appIcon = this.#deps.appIcon();
    this.#attempt("island", () =>
      this.#deps.showOnIsland(
        {
          serverId: "local",
          mode: "merged",
          item: {
            noticeId: notice.id,
            ticketTitle: notice.title,
            ticketKey: notice.ticketKey,
            prNumber: notice.prNumber,
            canOpenTicket: notice.ticketId !== null,
            canOpenPullRequest: notice.prUrl !== null,
            appIcon: { shape: appIcon.shape, color: appIcon.color, tile: appIcon.tile },
          },
        },
        TICKET_MERGE_ISLAND_MS,
      ),
    );
    this.#attempt("toast", () => this.#deps.sendToWindow(notice));
    if (this.#deps.desktopNotifications()) {
      this.#attempt("system notification", () => this.#showSystemNotification(notice, appIcon));
    }
    return notice;
  }

  /** "View ticket" or "View PR" from the toast, the island or the system notification. */
  async open(request: TicketMergeOpenRequest): Promise<void> {
    const notice = this.#notices.get(request.noticeId);
    if (!notice) return;
    if (request.target === "ticket") {
      if (notice.ticketId !== null) this.#deps.openTicketInWindow(notice);
      return;
    }
    // The contract accepts only an https URL, so nothing else reaches the browser.
    if (notice.prUrl !== null) await this.#deps.openExternal(notice.prUrl);
  }

  /** The facts line: "PASS · Quality 10/10 · CI green". */
  factsLine(notice: Pick<TicketMergeNotice, "verdict" | "qualityScore" | "ci">): string {
    const { translate } = this.#deps;
    const facts = [
      translate(notice.verdict === "PASS" ? "notification.ticketMerged.pass" : "notification.ticketMerged.passWithNotes"),
    ];
    if (notice.qualityScore !== null) {
      facts.push(translate("notification.ticketMerged.quality", { score: formatScore(notice.qualityScore) }));
    }
    if (notice.ci === "green") facts.push(translate("notification.ticketMerged.ciGreen"));
    return facts.join(" · ");
  }

  #notice(event: TicketMergedEvent): TicketMergeNotice {
    const redact = this.#deps.redact ?? redactText;
    const title = shortenTicketMergeTitle(redact(event.ticketTitle)) || (event.ticketKey ?? "");
    return {
      id: this.#deps.createId?.() ?? `merge-${Date.now().toString(36)}-${(this.#sequence += 1)}`,
      ticketId: event.ticketId,
      ticketKey: event.ticketKey,
      title: title.length > 0 ? title : "—",
      prNumber: event.prNumber,
      prUrl: event.prUrl,
      verdict: event.reviewer,
      qualityScore: event.qualityScore,
      ci: event.ci,
      mergedAt: event.mergedAt,
    };
  }

  #remember(notice: TicketMergeNotice): void {
    this.#notices.set(notice.id, notice);
    for (const oldest of this.#notices.keys()) {
      if (this.#notices.size <= NOTICE_LIMIT) break;
      this.#notices.delete(oldest);
    }
  }

  #showSystemNotification(notice: TicketMergeNotice, appIcon: AppLogoColorPreference): void {
    const { translate } = this.#deps;
    const body =
      notice.prNumber === null
        ? translate("notification.ticketMerged.bodyNoPullRequest")
        : translate("notification.ticketMerged.body", { number: String(notice.prNumber) });
    const targets: Array<TicketMergeOpenRequest["target"]> = [];
    const actions: string[] = [];
    if (notice.ticketId !== null) {
      targets.push("ticket");
      actions.push(translate("notification.ticketMerged.viewTicket"));
    }
    if (notice.prUrl !== null) {
      targets.push("pull-request");
      actions.push(translate("notification.ticketMerged.viewPullRequest"));
    }
    this.#deps.showSystemNotification({
      title: translate("notification.ticketMerged.title", { ticket: notice.title }),
      body: `${body} ${this.factsLine(notice)}`,
      icon: this.#deps.drawAppIcon(appIcon),
      actions,
      onAction: (index) => {
        // A click on the notification itself opens the ticket, or the PR when there is no ticket.
        const target = index === null ? targets[0] : targets[index];
        if (!target) return;
        void this.open({ noticeId: notice.id, target }).catch((error: unknown) =>
          this.#deps.reportError?.("Unable to open the merged ticket:", error),
        );
      },
    });
  }

  #attempt(surface: string, show: () => void): void {
    try {
      show();
    } catch (error) {
      // One surface failing must not keep the others from showing.
      this.#deps.reportError?.(`Unable to show the merge on the ${surface}:`, error);
    }
  }
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
