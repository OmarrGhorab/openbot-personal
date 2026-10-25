import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false, on: vi.fn(), getPath: () => "/tmp" },
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  screen: { on: vi.fn(), getAllDisplays: () => [], getPrimaryDisplay: vi.fn() },
  nativeTheme: { on: vi.fn() },
}));

const { dynamicIslandWindowBounds, dynamicIslandNotchSizeForDisplay } = await import("./dynamic-island-window");

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
