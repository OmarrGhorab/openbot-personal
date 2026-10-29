import { createSignal } from "solid-js";
import { autonomyPort } from "./autonomy-port";

/**
 * The Stop all agents switch of the sidebar header. It shows the stop that this computer holds and
 * changes it. The stop lives in main, so a restart keeps it, and the switch reads it again on mount.
 */
interface StopAllControl {
  /** Whether Stop all agents is on. */
  stopped: () => boolean;
  /** Whether main has answered the first read. The switch stays off until then. */
  ready: () => boolean;
  refresh(): Promise<void>;
  /** Stops every agent, or resumes them when the stop is on. Rejects when main cannot change it. */
  toggle(): Promise<void>;
}

export function createStopAllControl(): StopAllControl {
  const [stopped, setStopped] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const apply = (snapshot: { stoppedAll: boolean }) => {
    setStopped(snapshot.stoppedAll);
    setReady(true);
  };
  return {
    stopped,
    ready,
    refresh: () =>
      autonomyPort()
        .getSnapshot()
        .then(apply, () => undefined),
    toggle: () => (stopped() ? autonomyPort().resumeAll() : autonomyPort().stopAll()).then(apply),
  };
}
