// The main window's way back from a dead or hung renderer (ticket 246). A renderer killed by the kernel
// for memory left a dead or blank window, and Ctrl+R did nothing. Main now reloads the page itself after
// a crash. A crash loop stops after a few reloads and asks the person instead, and a hung page asks
// whether to reload or wait.

/** Why a renderer ended, as Electron reports it. `clean-exit` is a normal close. */
type RendererGoneReason =
  | "clean-exit"
  | "abnormal-exit"
  | "killed"
  | "crashed"
  | "oom"
  | "launch-failed"
  | "integrity-failure"
  | "memory-eviction";

/** The most automatic reloads in the window below; after that the person decides. */
export const RENDERER_AUTO_RELOADS = 3;
export const RENDERER_RELOAD_WINDOW_MS = 5 * 60_000;

export interface RendererRecoveryOptions {
  now: () => number;
  /** Loads the app page again in the same window. */
  reload: () => void;
  /** Asks the person: true to reload, false to leave the window as it is (wait or quit). */
  ask: (kind: "crashed" | "unresponsive") => Promise<boolean>;
}

export interface RendererRecovery {
  gone: (reason: RendererGoneReason) => Promise<"ignored" | "reloaded" | "asked">;
  unresponsive: () => Promise<"reloaded" | "waiting">;
}

export function createRendererRecovery(options: RendererRecoveryOptions): RendererRecovery {
  const reloads: number[] = [];
  let asking = false;

  async function ask(kind: "crashed" | "unresponsive"): Promise<boolean> {
    if (asking) return false;
    asking = true;
    try {
      return await options.ask(kind);
    } finally {
      asking = false;
    }
  }

  return {
    async gone(reason) {
      if (reason === "clean-exit") return "ignored";
      const now = options.now();
      while (reloads.length > 0 && now - (reloads[0] ?? now) > RENDERER_RELOAD_WINDOW_MS) reloads.shift();
      if (reloads.length < RENDERER_AUTO_RELOADS) {
        reloads.push(now);
        options.reload();
        return "reloaded";
      }
      if (await ask("crashed")) {
        reloads.length = 0;
        options.reload();
      }
      return "asked";
    },
    async unresponsive() {
      if (await ask("unresponsive")) {
        options.reload();
        return "reloaded";
      }
      return "waiting";
    },
  };
}
