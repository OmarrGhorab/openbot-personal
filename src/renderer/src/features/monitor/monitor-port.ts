import type { MonitorChange, MonitorSnapshot } from "@openbot/contracts/ipc";

/** What the Monitor reads: the snapshot of one channel, and the change that asks for a new read. */
export interface MonitorSource {
  snapshot(channelId: string): Promise<MonitorSnapshot>;
  /** Calls `listener` when the snapshot of a channel changed. Returns the unsubscribe. */
  onChange(listener: (change: MonitorChange) => void): () => void;
}

/**
 * The Monitor on desktop: main builds and redacts the snapshot of a local channel. Read on each call:
 * tests and stories replace `window.openbot` per case.
 */
export function desktopMonitorSource(): MonitorSource {
  return {
    snapshot: (channelId) => window.openbot.monitor.getSnapshot({ channelId }),
    onChange: (listener) => window.openbot.monitor.onChanged(listener),
  };
}
