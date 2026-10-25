// Microphone and Accessibility for the global voice shortcut. The renderer never receives a
// settings URL: main opens the pane.

import type { GlobalVoiceMicrophoneAccess } from "@openbot/contracts/ipc";
import { shell, systemPreferences } from "electron";

const ACCESSIBILITY_URL =
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility";
const MICROPHONE_URL = "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone";

/** `granted` or `denied` on macOS. Other computers have no Accessibility grant. */
export function readGlobalVoiceAccessibility(prompt: boolean): "granted" | "denied" | "unsupported" {
  if (process.platform !== "darwin") return "unsupported";
  return systemPreferences.isTrustedAccessibilityClient(prompt) ? "granted" : "denied";
}

export function readGlobalVoiceMicrophone(): GlobalVoiceMicrophoneAccess {
  if (process.platform !== "darwin") return "unknown";
  const status = systemPreferences.getMediaAccessStatus("microphone");
  if (status === "granted") return "granted";
  if (status === "denied" || status === "restricted") return "denied";
  return "unknown";
}

/** Shows the system prompt, then the pane when the grant is still missing. */
export async function promptGlobalVoiceAccessibility(): Promise<void> {
  if (process.platform !== "darwin") return;
  systemPreferences.isTrustedAccessibilityClient(true);
  if (!systemPreferences.isTrustedAccessibilityClient(false)) await shell.openExternal(ACCESSIBILITY_URL);
}

/** Shows the system prompt, then the pane when the grant is still missing. */
export async function promptGlobalVoiceMicrophone(): Promise<void> {
  if (process.platform !== "darwin") return;
  const granted = await systemPreferences.askForMediaAccess("microphone");
  if (!granted) await shell.openExternal(MICROPHONE_URL);
}
