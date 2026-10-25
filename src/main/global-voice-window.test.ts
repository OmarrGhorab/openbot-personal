import { toGlobalVoicePreference } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  globalShortcut: {},
  app: {},
}));

const { globalVoiceTargetAgentId, requireGlobalVoicePickerSender } = await import("./global-voice-window");
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
  it("refuses a key with no modifier, and a key or modifier it does not know", () => {
    const base = { enabled: true, pickerAccelerator: "Alt+Shift+Space", sendAfterSpeaking: true, agentShortcuts: [] };
    expect(toGlobalVoicePreference({ ...base, accelerator: "V" })).toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "F8" })).toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "Alt+V" })).not.toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "Control+Space" })).not.toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "Hyper+V" })).toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "Alt+Alt+V" })).toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "VolumeUp" })).toBeNull();
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

  it("keeps a saved preference that has no hold mode or default agent", () => {
    const saved = {
      enabled: true,
      accelerator: "Alt+V",
      pickerAccelerator: "Alt+K",
      sendAfterSpeaking: true,
      agentShortcuts: [],
    };
    expect(toGlobalVoicePreference(saved)).toMatchObject({ captureMode: "hold", defaultAgentId: null });
    expect(toGlobalVoicePreference({ ...saved, captureMode: "toggle", defaultAgentId: "agent-1" })).toMatchObject({
      captureMode: "toggle",
      defaultAgentId: "agent-1",
    });
    expect(toGlobalVoicePreference({ ...saved, captureMode: "push" })).toBeNull();
    expect(toGlobalVoicePreference({ ...saved, defaultAgentId: "" })).toBeNull();
  });

  it("refuses an empty transcript and an unknown view", () => {
    expect(() => parseGlobalVoiceSendInput({ agentId: "agent-1", text: "   " })).toThrow();
    expect(() => parseGlobalVoiceViewState({ view: "everywhere", listening: false })).toThrow();
    expect(parseGlobalVoiceViewState({ view: "pill", listening: true })).toEqual({ view: "pill", listening: true });
  });
});

describe("global voice target agent", () => {
  const agents = [{ agentId: "recent" }, { agentId: "default" }, { agentId: "last" }, { agentId: "picked" }];

  it("targets the agent chosen in the picker before the default, the last sent and the most recent", () => {
    expect(globalVoiceTargetAgentId(agents, { picked: "picked", preferred: "default", last: "last" })).toBe("picked");
    expect(globalVoiceTargetAgentId(agents, { picked: null, preferred: "default", last: "last" })).toBe("default");
    expect(globalVoiceTargetAgentId(agents, { picked: null, preferred: null, last: "last" })).toBe("last");
    expect(globalVoiceTargetAgentId(agents, { picked: null, preferred: null, last: null })).toBe("recent");
  });

  it("skips a choice whose agent is no longer on this computer", () => {
    expect(globalVoiceTargetAgentId(agents, { picked: "gone", preferred: "default", last: "last" })).toBe("default");
    expect(globalVoiceTargetAgentId(agents, { picked: "gone", preferred: "gone", last: "gone" })).toBe("recent");
    expect(globalVoiceTargetAgentId([], { picked: "picked", preferred: null, last: null })).toBeNull();
  });
});
