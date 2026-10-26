import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false, on: vi.fn(), getPath: () => "/tmp" },
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  screen: { on: vi.fn(), getAllDisplays: () => [], getPrimaryDisplay: vi.fn() },
  nativeTheme: { on: vi.fn() },
}));

const { clampDynamicIslandPosition, dynamicIslandWindowBounds, dynamicIslandNotchSizeForDisplay } = await import(
  "./dynamic-island-window"
);

const WINDOW_WIDTH = 614;
const COMPACT_HEIGHT = 50;
const EXTERNAL_DISPLAY = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 25, width: 1920, height: 1055 },
};

describe("dynamic island window bounds", () => {
  it("floats below the menu bar on a display without a notch", () => {
    const display = {
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      workArea: { x: 0, y: 25, width: 2560, height: 1415 },
      internal: false,
    };
    expect(dynamicIslandNotchSizeForDisplay(display)).toBeUndefined();
    expect(dynamicIslandWindowBounds(display).y).toBe(27);
  });

  it("hangs from the top edge of a notched MacBook display", () => {
    const display = {
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      workArea: { x: 0, y: 38, width: 1512, height: 944 },
      internal: true,
    };
    expect(dynamicIslandNotchSizeForDisplay(display)).toBeDefined();
    expect(dynamicIslandWindowBounds(display).y).toBe(0);
  });
});

describe("dynamic island drag clamp", () => {
  it("lets the drawn island reach each screen edge, not the transparent window edge", () => {
    const left = clampDynamicIslandPosition(
      { x: -10_000, y: 100, islandWidth: 192 },
      EXTERNAL_DISPLAY,
      WINDOW_WIDTH,
      COMPACT_HEIGHT,
    );
    const right = clampDynamicIslandPosition(
      { x: 10_000, y: 100, islandWidth: 192 },
      EXTERNAL_DISPLAY,
      WINDOW_WIDTH,
      COMPACT_HEIGHT,
    );
    const inset = (WINDOW_WIDTH - 192) / 2;
    // The island is centered in the window, so the window may pass the edge by that inset.
    expect(left.x).toBe(-inset);
    expect(left.x + inset).toBe(0);
    expect(right.x).toBe(1920 - WINDOW_WIDTH + inset);
    expect(right.x + WINDOW_WIDTH - inset).toBe(1920);
  });

  it("keeps the compact island above the bottom edge and below the menu bar", () => {
    expect(clampDynamicIslandPosition({ x: 500, y: -10_000 }, EXTERNAL_DISPLAY, WINDOW_WIDTH, COMPACT_HEIGHT).y).toBe(
      25,
    );
    expect(clampDynamicIslandPosition({ x: 500, y: 10_000 }, EXTERNAL_DISPLAY, WINDOW_WIDTH, COMPACT_HEIGHT).y).toBe(
      1080 - COMPACT_HEIGHT,
    );
  });

  it("keeps the whole window on a display when the island width is unknown", () => {
    const left = clampDynamicIslandPosition({ x: -10_000, y: 100 }, EXTERNAL_DISPLAY, WINDOW_WIDTH, COMPACT_HEIGHT);
    const right = clampDynamicIslandPosition({ x: 10_000, y: 100 }, EXTERNAL_DISPLAY, WINDOW_WIDTH, COMPACT_HEIGHT);
    expect(left.x).toBe(0);
    expect(right.x).toBe(1920 - WINDOW_WIDTH);
  });

  it("follows a display that does not start at the top-left corner", () => {
    const display = {
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: -1920, y: 25, width: 1920, height: 1055 },
    };
    expect(clampDynamicIslandPosition({ x: -10_000, y: 100 }, display, WINDOW_WIDTH, COMPACT_HEIGHT).x).toBe(-1920);
    expect(clampDynamicIslandPosition({ x: 10_000, y: 100 }, display, WINDOW_WIDTH, COMPACT_HEIGHT).x).toBe(
      -WINDOW_WIDTH,
    );
  });
});
