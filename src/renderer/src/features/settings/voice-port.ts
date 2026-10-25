import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Voice tab reaches in main: the dictation models, the dictation settings and the global shortcuts. */
export interface VoicePort {
  voice: OpenBotDesktopApi["voice"];
  globalVoice: OpenBotDesktopApi["globalVoice"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function voicePort(): VoicePort {
  return window.openbot;
}
