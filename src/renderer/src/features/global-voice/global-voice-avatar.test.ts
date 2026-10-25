import { isGlobalVoicePickerSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { globalVoiceHasAvatar } from "./global-voice-picker-logic";

describe("globalVoiceHasAvatar", () => {
  it("draws the agent's mascot when it has a seed", () => {
    expect(globalVoiceHasAvatar({ avatarSeed: "chief", avatarUrl: null })).toBe(true);
  });

  it("draws the uploaded image", () => {
    expect(globalVoiceHasAvatar({ avatarSeed: "", avatarUrl: "openbot-avatar://agent/a1" })).toBe(true);
  });

  it("falls back to the initials without a seed or an image", () => {
    expect(globalVoiceHasAvatar({ avatarSeed: " ", avatarUrl: null })).toBe(false);
  });
});

describe("the picker opening carries each agent's avatar", () => {
  const agent = {
    agentId: "a1",
    name: "Agent One",
    title: "",
    updatedAt: null,
    avatarSeed: "chief",
    avatarHue: null,
    avatarUrl: null,
  };
  const snapshot = (agents: unknown[]) => ({
    id: 1,
    request: { type: "choose" },
    currentAgentId: null,
    agents,
    sendAfterSpeaking: true,
    captureMode: "hold",
    holdToTalk: true,
    keyRelease: "ready",
  });

  it("accepts an agent with its avatar", () => {
    expect(isGlobalVoicePickerSnapshot(snapshot([agent]))).toBe(true);
    expect(isGlobalVoicePickerSnapshot(snapshot([{ ...agent, avatarUrl: "openbot-avatar://agent/a1" }]))).toBe(true);
  });

  it("rejects an agent whose avatar fields are missing or the wrong type", () => {
    const { avatarSeed: _seed, ...withoutSeed } = agent;
    expect(isGlobalVoicePickerSnapshot(snapshot([withoutSeed]))).toBe(false);
    expect(isGlobalVoicePickerSnapshot(snapshot([{ ...agent, avatarUrl: 3 }]))).toBe(false);
    expect(isGlobalVoicePickerSnapshot(snapshot([{ ...agent, avatarHue: "red-ish" }]))).toBe(false);
  });
});
