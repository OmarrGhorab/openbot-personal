// The Raven Autopilot settings of the preview: in memory, from the defaults or a story's seed. `set`
// reads the settings field by field as main does, and tells every listener.

import {
  normalizeRavenAutopilotSettings,
  type OpenBotDesktopApi,
  type RavenAutopilotSettings,
} from "@openbot/contracts/ipc";

type RavenAutopilotApi = OpenBotDesktopApi["ravenAutopilot"];

export function mockRavenAutopilot(seed?: Partial<RavenAutopilotSettings>): RavenAutopilotApi {
  let settings = normalizeRavenAutopilotSettings(seed ?? null);
  const listeners = new Set<(settings: RavenAutopilotSettings) => void>();
  return {
    get: async () => normalizeRavenAutopilotSettings(settings),
    set: async (next) => {
      settings = normalizeRavenAutopilotSettings(next);
      for (const listener of listeners) listener(normalizeRavenAutopilotSettings(settings));
      return normalizeRavenAutopilotSettings(settings);
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
