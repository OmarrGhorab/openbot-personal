import { UiohookKey as PackageKeys } from "uiohook-napi";
import { describe, expect, it, vi } from "vitest";
import {
  acceleratorIsDown,
  acceleratorReleased,
  createGlobalKeyRelease,
  type GlobalKeyEvent,
  type KeyHook,
  loadUiohook,
  parseGlobalVoiceAccelerator,
} from "./global-key-release";
import { UiohookKey } from "./uiohook-keys";

function event(patch: Partial<GlobalKeyEvent> & Pick<GlobalKeyEvent, "type" | "keycode">): GlobalKeyEvent {
  return { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...patch };
}

describe("global voice key release", () => {
  it("matches Option+V only while Option is held, and ends on either release", () => {
    const parsed = parseGlobalVoiceAccelerator("Alt+V", "darwin");
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const down = event({ type: "down", keycode: UiohookKey.V, altKey: true });
    expect(acceleratorIsDown(parsed, down)).toBe(true);
    expect(acceleratorIsDown(parsed, event({ type: "down", keycode: UiohookKey.V }))).toBe(false);
    expect(
      acceleratorIsDown(parsed, event({ type: "down", keycode: UiohookKey.V, altKey: true, shiftKey: true })),
    ).toBe(false);
    expect(acceleratorReleased(parsed, event({ type: "up", keycode: UiohookKey.V, altKey: true }))).toBe(true);
    expect(acceleratorReleased(parsed, event({ type: "up", keycode: UiohookKey.Alt }))).toBe(true);
    expect(acceleratorReleased(parsed, event({ type: "up", keycode: UiohookKey.A, altKey: true }))).toBe(false);
    expect(acceleratorReleased(parsed, event({ type: "down", keycode: UiohookKey.V, altKey: true }))).toBe(false);
  });

  it("treats CommandOrControl as Command on macOS and Control on other systems", () => {
    const mac = parseGlobalVoiceAccelerator("CommandOrControl+K", "darwin");
    const linux = parseGlobalVoiceAccelerator("CommandOrControl+K", "linux");
    expect(mac && acceleratorIsDown(mac, event({ type: "down", keycode: UiohookKey.K, metaKey: true }))).toBe(true);
    expect(mac && acceleratorIsDown(mac, event({ type: "down", keycode: UiohookKey.K, ctrlKey: true }))).toBe(false);
    expect(linux && acceleratorIsDown(linux, event({ type: "down", keycode: UiohookKey.K, ctrlKey: true }))).toBe(true);
    expect(linux && acceleratorIsDown(linux, event({ type: "down", keycode: UiohookKey.K, metaKey: true }))).toBe(
      false,
    );
  });

  it("has no code for a key the hook cannot see", () => {
    expect(parseGlobalVoiceAccelerator("Alt+VolumeUp", "darwin")).toBeNull();
  });

  it("keeps the copied key codes equal to the package", () => {
    expect({ ...UiohookKey }).toEqual({ ...PackageKeys });
  });

  it("reports the hook unavailable instead of throwing when the native addon cannot load", () => {
    const release = createGlobalKeyRelease(() =>
      loadUiohook(() => {
        throw new Error("\\?\\C:\\uiohook_napi.node is not a valid Win32 application.");
      }),
    );
    expect(release.start()).toBe("unavailable");
    expect(() => release.stop()).not.toThrow();
  });

  it("rejects a module without the uIOhook export", () => {
    expect(() => loadUiohook(() => ({}))).toThrow(/no uIOhook export/u);
  });

  it("loads the hook only on start, and starts it once", () => {
    const hook: KeyHook = { on: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const load = vi.fn(() => hook);
    const release = createGlobalKeyRelease(load);
    expect(load).not.toHaveBeenCalled();
    expect(release.start()).toBe("ready");
    expect(release.start()).toBe("ready");
    expect(load).toHaveBeenCalledTimes(1);
    expect(hook.start).toHaveBeenCalledTimes(1);
    release.stop();
    expect(hook.stop).toHaveBeenCalledTimes(1);
  });
});
