import { describe, expect, it } from "vitest";
import {
  GLOBAL_VOICE_ISLAND,
  GLOBAL_VOICE_ISLAND_RADIUS,
  GLOBAL_VOICE_PICKER_ROW,
  globalVoicePickerSize,
  globalVoiceTextDirection,
  islandMorphKeyframes,
  islandRadius,
} from "./global-voice-island-motion";

function px(value: unknown): number {
  return Number.parseFloat(String(value));
}

describe("global voice island motion", () => {
  it("grows out of the notch past its size, then settles on it", () => {
    const to = globalVoicePickerSize(2);
    const frames = islandMorphKeyframes(GLOBAL_VOICE_ISLAND.notch, to, false);
    const widths = frames.map((frame) => px(frame.width));
    expect(widths[0]).toBeCloseTo(GLOBAL_VOICE_ISLAND.notch.width, 5);
    expect(Math.max(...widths)).toBeGreaterThan(to.width);
    expect(widths.at(-1)).toBeCloseTo(to.width, 5);
    expect(px(frames.at(-1)?.height)).toBeCloseTo(to.height, 5);
    expect(frames.at(-1)?.borderRadius).toBe(
      `0 0 ${GLOBAL_VOICE_ISLAND_RADIUS}.00px ${GLOBAL_VOICE_ISLAND_RADIUS}.00px`,
    );
  });

  it("keeps the notch round and the top corners square", () => {
    expect(islandRadius(GLOBAL_VOICE_ISLAND.notch)).toBe(16);
    const first = islandMorphKeyframes(GLOBAL_VOICE_ISLAND.notch, GLOBAL_VOICE_ISLAND.pill, false)[0];
    expect(first?.borderRadius).toBe("0 0 16.00px 16.00px");
  });

  it("fades without a change of size when the user asked for less motion", () => {
    const frames = islandMorphKeyframes(GLOBAL_VOICE_ISLAND.notch, GLOBAL_VOICE_ISLAND.pill, true);
    expect(frames.map((frame) => frame.opacity)).toEqual([0, 1]);
    expect(frames.map((frame) => frame.width)).toEqual(["420px", "420px"]);
  });

  it("fits the picker to its rows, up to three, with no empty space", () => {
    const one = globalVoicePickerSize(1);
    const three = globalVoicePickerSize(3);
    expect(globalVoicePickerSize(0)).toEqual(one);
    expect(three.height - one.height).toBe(2 * GLOBAL_VOICE_PICKER_ROW);
    expect(globalVoicePickerSize(9)).toEqual(three);
    expect(three.height).toBeLessThan(240);
  });

  it("keeps Arabic text right to left", () => {
    expect(globalVoiceTextDirection("ابعت التقرير")).toBe("rtl");
    expect(globalVoiceTextDirection("Send the report")).toBe("ltr");
    expect(globalVoiceTextDirection("تقرير اليوم report")).toBe("rtl");
  });
});
