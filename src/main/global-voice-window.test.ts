import { toGlobalVoicePreference } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  globalShortcut: {},
  app: {},
}));

const { requireGlobalVoicePickerSender } = await import("./global-voice-window");
const { parseGlobalVoiceSendInput, parseGlobalVoiceViewState } = await import("./ipc/global-voice-inputs");

describe("global voice picker sender", () => {
  it("accepts the window's own renderer only", () => {
    const pickerIds = new Set([7]);
    expect(() => requireGlobalVoicePickerSender(7, pickerIds)).not.toThrow();
    expect(() => requireGlobalVoicePickerSender(8, pickerIds)).toThrow();
    expect(() => requireGlobalVoicePickerSender(7, new Set())).toThrow();
  });
});

describe("global voice inputs", () => {
  it("refuses a shortcut with no modifier, which would take the key from every app", () => {
    const base = { enabled: true, pickerAccelerator: "Alt+Shift+Space", sendAfterSpeaking: true, agentShortcuts: [] };
    expect(toGlobalVoicePreference({ ...base, accelerator: "Space" })).toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "Control+Space" })).not.toBeNull();
  });

  it("refuses a duplicate agent shortcut", () => {
    const base = {
      enabled: true,
      accelerator: "Control+Space",
      pickerAccelerator: "Alt+Space",
      sendAfterSpeaking: true,
    };
    const shortcut = { agentId: "agent-1", accelerator: "Control+Shift+K" };
    expect(toGlobalVoicePreference({ ...base, agentShortcuts: [shortcut, shortcut] })).toBeNull();
  });

  it("refuses an empty transcript and an unknown view", () => {
    expect(() => parseGlobalVoiceSendInput({ agentId: "agent-1", text: "   " })).toThrow();
    expect(() => parseGlobalVoiceViewState({ view: "everywhere", listening: false })).toThrow();
    expect(parseGlobalVoiceViewState({ view: "pill", listening: true })).toEqual({ view: "pill", listening: true });
  });
});
