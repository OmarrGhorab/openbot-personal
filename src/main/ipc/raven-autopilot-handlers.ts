// The Autopilot settings of the Raven team. They stay on this computer, so both endpoints are plain
// requests on this computer.

import { isRavenAutopilotSettings, type RavenAutopilotSettings } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { RavenAutopilotSettingsStore } from "../raven-autopilot-settings";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

interface RavenAutopilotIpcDependencies {
  ravenAutopilot: RavenAutopilotSettingsStore;
}

function parseRavenAutopilotSettings(value: unknown): RavenAutopilotSettings {
  if (!isRavenAutopilotSettings(value)) throw new Error("Invalid Autopilot settings.");
  return value;
}

export function ravenAutopilotIpcHandlers({
  ravenAutopilot,
}: RavenAutopilotIpcDependencies): Pick<IpcGroupHandlers, "ravenAutopilot"> {
  return {
    ravenAutopilot: {
      get: handler(() => ravenAutopilot.current()),
      set: payloadHandler(parseRavenAutopilotSettings, (settings) => runCauseEffect(ravenAutopilot.set(settings))),
    },
  };
}
