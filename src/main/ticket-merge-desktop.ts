import { resolve } from "node:path";
import { type AppLogoColorPreference, IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { app, type BrowserWindow, type NativeImage, Notification } from "electron";
import { resolveMascotPath } from "./app-icon";
import { composeMascotIcon } from "./app-icon-mascot";
import { showRetainedNotification } from "./desktop-notifications";
import type { DynamicIslandWindowController } from "./dynamic-island-window";
import { sendToRenderer } from "./renderer-ipc";
import { TicketMergeNotifier } from "./ticket-merge-notifier";

export interface DesktopTicketMergeOptions {
  /**
   * The "Tell me when it merges" setting from the Autopilot settings (#195). When that store is in
   * the build, pass `() => services.ravenAutopilot.current().notifyOnMerge`. Until then the
   * notification is on, which is the setting's default.
   */
  notifyOnMerge?: () => boolean;
  desktopNotifications: () => boolean;
  appIcon: () => AppLogoColorPreference;
  dynamicIsland: Pick<DynamicIslandWindowController, "showTransient">;
  getMainWindow: () => BrowserWindow | null;
  ensureMainWindow: () => Promise<BrowserWindow>;
  showMainWindow: (window: BrowserWindow) => void;
  openExternal: (url: string) => Promise<void>;
  translate: AppTranslate;
  reportError: (message: string, error: unknown) => void;
}

/** The notifier with the Electron surfaces: the island controller, a system notification and the main window. */
export function createDesktopTicketMergeNotifier(options: DesktopTicketMergeOptions): TicketMergeNotifier {
  return new TicketMergeNotifier({
    notifyOnMerge: options.notifyOnMerge ?? (() => true),
    desktopNotifications: options.desktopNotifications,
    appIcon: options.appIcon,
    showSystemNotification: (shown) => {
      if (!Notification.isSupported()) return;
      const icon = drawNotificationIcon(shown.appIcon);
      const notification = new Notification({
        title: shown.title,
        body: shown.body,
        // No icon keeps the system's own icon when the mascot file is missing.
        ...(icon ? { icon } : {}),
        // macOS shows the buttons; elsewhere a click on the notification opens the ticket.
        actions: process.platform === "darwin" ? shown.actions.map((text) => ({ type: "button", text })) : [],
      });
      notification.on("click", () => shown.onAction(null));
      notification.on("action", (_event, index) => shown.onAction(index));
      showRetainedNotification(notification);
    },
    showOnIsland: (presentation, durationMs) => options.dynamicIsland.showTransient(presentation, durationMs),
    sendToWindow: (notice) => {
      const window = options.getMainWindow();
      if (window && !window.isDestroyed()) sendToRenderer(window, IPC_ENDPOINTS.notifications.ticketMerged, notice);
    },
    openTicketInWindow: (notice) => {
      void options
        .ensureMainWindow()
        .then((window) => {
          options.showMainWindow(window);
          sendToRenderer(window, IPC_ENDPOINTS.notifications.ticketMergeOpened, { notice });
        })
        .catch((error: unknown) => options.reportError("Unable to open the merged ticket:", error));
    },
    openExternal: options.openExternal,
    translate: options.translate,
    reportError: options.reportError,
  });
}

/**
 * The App icon from Settings › Appearance, drawn as a full tile so it reads at notification size.
 * The old two-dot logo is never used. Undefined keeps the system's own icon when the mascot file is
 * missing.
 */
function drawNotificationIcon(preference: AppLogoColorPreference): NativeImage | undefined {
  const icon = composeMascotIcon({
    preference,
    // The notification draws its own frame, so the icon takes the full-size tile on every system.
    platform: "linux",
    mascotPath: resolveMascotPath({
      shape: preference.shape,
      color: preference.color,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sourceRoot: resolve(__dirname, "../.."),
    }),
  });
  return icon.isEmpty() ? undefined : icon;
}
