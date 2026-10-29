import { isOneOf } from "./runtime-values";

/**
 * Where a link from a conversation opens. The values are the English names that settings saves and
 * shows, so a saved value stays readable. `OpenBot` is the browser inside the app; the others are
 * programs on this computer, and a link falls back to the default browser when one is not installed.
 * The value crosses IPC and is saved as written, so remove a name only with a read that maps it.
 */
export const APP_LINK_BROWSERS = [
  "Default browser",
  "OpenBot",
  "Google Chrome",
  "Brave",
  "Firefox",
  "Microsoft Edge",
] as const;
export type AppLinkBrowser = (typeof APP_LINK_BROWSERS)[number];
export const DEFAULT_APP_LINK_BROWSER: AppLinkBrowser = "Default browser";

/** The preference as it is stored and as it crosses IPC. */
export interface AppLinkBrowserPreference {
  browser: AppLinkBrowser;
}

export function isAppLinkBrowser(value: unknown): value is AppLinkBrowser {
  return isOneOf(APP_LINK_BROWSERS, value);
}
