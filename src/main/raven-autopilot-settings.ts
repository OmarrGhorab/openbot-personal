import {
  normalizeRavenAutopilotSettings,
  RAVEN_AUTOPILOT_DEFAULT_SETTINGS,
  type RavenAutopilotSettings,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { type PreferenceFileFailure, PreferenceStore } from "./preference-file";

/** The file in the app's user data folder. */
export const RAVEN_AUTOPILOT_PREFERENCE_FILE = "openbot-raven-autopilot-v1.json";

/**
 * The Autopilot settings of the Raven team. They stay on this computer, in one version 1 preference
 * file. A file that is missing or unreadable reads as the defaults, and a field that is missing or not
 * valid takes its default, so the user turns Autopilot on and needs nothing else.
 *
 * Main holds the settings in memory after `load`. The Autopilot engine (#196), the Reviewer merge (#198)
 * and the merge notification (#199) read `current()` each time they decide, so a change applies to the
 * next decision at once. `subscribe` tells a reader that the settings changed.
 */
export class RavenAutopilotSettingsStore {
  readonly #store: PreferenceStore<RavenAutopilotSettings>;
  readonly #listeners = new Set<(settings: RavenAutopilotSettings) => void>();

  constructor(path: string) {
    this.#store = new PreferenceStore({
      path,
      defaultValue: RAVEN_AUTOPILOT_DEFAULT_SETTINGS,
      decode: (parsed) =>
        isDynamicRecord(parsed) && parsed.version === 1 ? normalizeRavenAutopilotSettings(parsed) : null,
    });
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return this.#store.load();
  }

  /** A fresh copy of the current settings. */
  current(): RavenAutopilotSettings {
    return normalizeRavenAutopilotSettings(this.#store.get());
  }

  readonly set = Effect.fn("RavenAutopilotSettings.set")(function* (
    this: RavenAutopilotSettingsStore,
    settings: RavenAutopilotSettings,
  ) {
    yield* this.#store.set(normalizeRavenAutopilotSettings(settings));
    const saved = this.current();
    for (const listener of this.#listeners) listener(saved);
    return saved;
  });

  /** Calls `listener` after each saved change. Answers the unsubscribe call. */
  subscribe(listener: (settings: RavenAutopilotSettings) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
