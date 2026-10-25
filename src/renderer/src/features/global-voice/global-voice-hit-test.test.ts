import { describe, expect, it } from "vitest";
import { pointInRect } from "./global-voice-picker-logic";

describe("pointInRect", () => {
  const island = { left: 100, right: 420, top: 0, bottom: 300 };

  it("takes a click on the island", () => {
    expect(pointInRect(island, 260, 150)).toBe(true);
    expect(pointInRect(island, 100, 0)).toBe(true);
  });

  it("passes through a click on the transparent rest of the window", () => {
    expect(pointInRect(island, 50, 150)).toBe(false);
    expect(pointInRect(island, 260, 480)).toBe(false);
  });

  it("passes every click through while no island is drawn", () => {
    expect(pointInRect(undefined, 260, 150)).toBe(false);
  });
});
