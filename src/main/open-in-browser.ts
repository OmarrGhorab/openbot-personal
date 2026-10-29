import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppLinkBrowser } from "@openbot/contracts/ipc";

const run = promisify(execFile);

type NamedBrowser = Exclude<AppLinkBrowser, "Default browser" | "OpenBot">;

/** The macOS application name, the Linux command, and the Windows folder and program of each browser. */
const BROWSERS: Record<NamedBrowser, { mac: string; linux: string; windows: readonly string[] }> = {
  "Google Chrome": {
    mac: "Google Chrome",
    linux: "google-chrome",
    windows: ["Google\\Chrome\\Application\\chrome.exe"],
  },
  Brave: {
    mac: "Brave Browser",
    linux: "brave-browser",
    windows: ["BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
  },
  Firefox: { mac: "Firefox", linux: "firefox", windows: ["Mozilla Firefox\\firefox.exe"] },
  "Microsoft Edge": {
    mac: "Microsoft Edge",
    linux: "microsoft-edge",
    windows: ["Microsoft\\Edge\\Application\\msedge.exe"],
  },
};

function windowsProgram(relative: readonly string[]): string | null {
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA];
  for (const root of roots) {
    if (!root) continue;
    for (const path of relative) {
      const full = join(root, path);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

/**
 * Opens the address in the chosen browser. The program starts with the address as an argument and
 * no shell, so no character of the address is read as a command. A browser that is not installed
 * rejects, and the caller opens the default browser instead. `Default browser` and `OpenBot` have no
 * program of their own: the caller handles them.
 */
async function openInBrowser(browser: NamedBrowser, url: string): Promise<void> {
  const entry = BROWSERS[browser];
  if (process.platform === "darwin") {
    await run("open", ["-a", entry.mac, url]);
  } else if (process.platform === "win32") {
    const program = windowsProgram(entry.windows);
    if (!program) throw new Error(`${browser} is not installed.`);
    await run(program, [url]);
  } else {
    await run(entry.linux, [url]);
  }
}

/**
 * Opens a link in the chosen browser, or in the default one when the choice has no program of its
 * own (`Default browser`, `OpenBot`: the renderer shows that one) or the program did not start.
 */
export async function openLink(
  browser: AppLinkBrowser,
  url: string,
  openDefault: (url: string) => Promise<void>,
): Promise<void> {
  if (isNamedBrowser(browser)) {
    try {
      return await openInBrowser(browser, url);
    } catch {
      // The browser is not installed or did not start: the link still opens.
    }
  }
  return openDefault(url);
}

function isNamedBrowser(browser: AppLinkBrowser): browser is NamedBrowser {
  return browser !== "Default browser" && browser !== "OpenBot";
}
