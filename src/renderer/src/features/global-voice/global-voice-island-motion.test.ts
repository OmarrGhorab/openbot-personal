import { describe, expect, it } from "vitest";
import { GLOBAL_VOICE_ISLAND, globalVoiceTextDirection, islandScaleKeyframes } from "./global-voice-island-motion";

function scaleX(frame: Keyframe): number {
  const transform = typeof frame.transform === "string" ? frame.transform : "";
  const match = /scale\(([-0-9.]+)/u.exec(transform);
  return Number(match?.[1] ?? "1");
}

describe("global voice island motion", () => {
  it("grows past the target size, then settles", () => {
    const frames = islandScaleKeyframes(GLOBAL_VOICE_ISLAND.notch, GLOBAL_VOICE_ISLAND.picker, false);
    const scales = frames.map(scaleX);
    expect(Math.max(...scales)).toBeGreaterThan(1);
    expect(scales.at(-1)).toBeCloseTo(1, 5);
    expect(frames[0]?.transform).not.toBe("none");
  });

  it("fades when the user asked for less motion", () => {
    const frames = islandScaleKeyframes(GLOBAL_VOICE_ISLAND.picker, GLOBAL_VOICE_ISLAND.notch, true);
    expect(frames.map((frame) => frame.transform)).toEqual(["none", "none"]);
    expect(frames.map((frame) => frame.opacity)).toEqual([0, 1]);
  });

  it("keeps Arabic text right to left", () => {
    expect(globalVoiceTextDirection("ابعت التقرير")).toBe("rtl");
    expect(globalVoiceTextDirection("Send the report")).toBe("ltr");
    expect(globalVoiceTextDirection("تقرير اليوم report")).toBe("rtl");
  });
});
