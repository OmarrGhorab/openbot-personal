// Key-up for the global voice shortcuts. Electron's globalShortcut reports the press only, so
// hold-to-talk needs a hook that also reports the release. On macOS the hook needs Accessibility.
// The numbers are the key codes of uiohook-napi 1.5.5.

import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { UiohookKey, type UiohookKeyboardEvent, uIOhook } from "uiohook-napi";

const logger = createOpenBotLogger("global-voice-keys");

export interface GlobalKeyEvent {
  type: "down" | "up";
  keycode: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface ParsedAccelerator {
  keyCode: number;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** Left and right codes for each required modifier, so either side ends the hold. */
  modifierCodes: readonly number[];
}

const NAMED_KEYS: Readonly<Record<string, number>> = {
  Space: UiohookKey.Space,
  Tab: UiohookKey.Tab,
  Enter: UiohookKey.Enter,
  Backspace: UiohookKey.Backspace,
  Delete: UiohookKey.Delete,
  Insert: UiohookKey.Insert,
  Up: UiohookKey.ArrowUp,
  Down: UiohookKey.ArrowDown,
  Left: UiohookKey.ArrowLeft,
  Right: UiohookKey.ArrowRight,
  Home: UiohookKey.Home,
  End: UiohookKey.End,
  PageUp: UiohookKey.PageUp,
  PageDown: UiohookKey.PageDown,
};

const MODIFIER_CODES = {
  alt: [UiohookKey.Alt, UiohookKey.AltRight],
  ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  meta: [UiohookKey.Meta, UiohookKey.MetaRight],
  shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
} as const;

const KEY_CODES: Readonly<Record<string, number>> = {
  A: UiohookKey.A,
  B: UiohookKey.B,
  C: UiohookKey.C,
  D: UiohookKey.D,
  E: UiohookKey.E,
  F: UiohookKey.F,
  G: UiohookKey.G,
  H: UiohookKey.H,
  I: UiohookKey.I,
  J: UiohookKey.J,
  K: UiohookKey.K,
  L: UiohookKey.L,
  M: UiohookKey.M,
  N: UiohookKey.N,
  O: UiohookKey.O,
  P: UiohookKey.P,
  Q: UiohookKey.Q,
  R: UiohookKey.R,
  S: UiohookKey.S,
  T: UiohookKey.T,
  U: UiohookKey.U,
  V: UiohookKey.V,
  W: UiohookKey.W,
  X: UiohookKey.X,
  Y: UiohookKey.Y,
  Z: UiohookKey.Z,
  0: UiohookKey[0],
  1: UiohookKey[1],
  2: UiohookKey[2],
  3: UiohookKey[3],
  4: UiohookKey[4],
  5: UiohookKey[5],
  6: UiohookKey[6],
  7: UiohookKey[7],
  8: UiohookKey[8],
  9: UiohookKey[9],
  F1: UiohookKey.F1,
  F2: UiohookKey.F2,
  F3: UiohookKey.F3,
  F4: UiohookKey.F4,
  F5: UiohookKey.F5,
  F6: UiohookKey.F6,
  F7: UiohookKey.F7,
  F8: UiohookKey.F8,
  F9: UiohookKey.F9,
  F10: UiohookKey.F10,
  F11: UiohookKey.F11,
  F12: UiohookKey.F12,
  F13: UiohookKey.F13,
  F14: UiohookKey.F14,
  F15: UiohookKey.F15,
  F16: UiohookKey.F16,
  F17: UiohookKey.F17,
  F18: UiohookKey.F18,
  F19: UiohookKey.F19,
  F20: UiohookKey.F20,
  F21: UiohookKey.F21,
  F22: UiohookKey.F22,
  F23: UiohookKey.F23,
  F24: UiohookKey.F24,
  ...NAMED_KEYS,
};

/** The key code of an Electron accelerator key, or null when this hook has no code for it. */
export function globalVoiceKeyCode(key: string): number | null {
  return KEY_CODES[key] ?? null;
}

/** Splits an Electron accelerator into the key and the modifiers the hook compares. */
export function parseGlobalVoiceAccelerator(accelerator: string, platform: NodeJS.Platform): ParsedAccelerator | null {
  const parts = accelerator.split("+");
  const key = parts.at(-1) ?? "";
  const keyCode = globalVoiceKeyCode(key);
  if (keyCode === null) return null;
  const modifiers = parts.slice(0, -1);
  let alt = false;
  let ctrl = false;
  let meta = false;
  let shift = false;
  for (const modifier of modifiers) {
    if (modifier === "Alt") alt = true;
    else if (modifier === "Shift") shift = true;
    else if (modifier === "Control") ctrl = true;
    else if (modifier === "Command" || modifier === "Super") meta = true;
    else if (modifier === "CommandOrControl") {
      if (platform === "darwin") meta = true;
      else ctrl = true;
    } else return null;
  }
  const modifierCodes = [
    ...(alt ? MODIFIER_CODES.alt : []),
    ...(ctrl ? MODIFIER_CODES.ctrl : []),
    ...(meta ? MODIFIER_CODES.meta : []),
    ...(shift ? MODIFIER_CODES.shift : []),
  ];
  return { keyCode, alt, ctrl, meta, shift, modifierCodes };
}

/** Whether this key event is the shortcut held down, with no extra modifier. */
export function acceleratorIsDown(parsed: ParsedAccelerator, event: GlobalKeyEvent): boolean {
  return (
    event.keycode === parsed.keyCode &&
    event.altKey === parsed.alt &&
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    event.shiftKey === parsed.shift
  );
}

/**
 * Whether this key-up ends a hold of the shortcut. Releasing the letter or any required modifier
 * ends it. Releasing an unrelated key does not.
 */
export function acceleratorReleased(parsed: ParsedAccelerator, event: GlobalKeyEvent): boolean {
  if (event.type !== "up") return false;
  return event.keycode === parsed.keyCode || parsed.modifierCodes.includes(event.keycode);
}

export interface GlobalKeyRelease {
  /** Starts the native hook. A second call keeps the hook that is already running. */
  start(): "ready" | "unavailable";
  stop(): void;
  setAccelerators(accelerators: readonly string[], platform: NodeJS.Platform): void;
  onRelease(listener: (accelerator: string) => void): void;
}

/**
 * One process-wide key hook. uiohook allows one listener loop, so the voice controller is the only
 * caller. The hook does not prompt for Accessibility: the controller does that from Settings.
 */
export function createGlobalKeyRelease(): GlobalKeyRelease {
  const held = new Set<string>();
  let parsed = new Map<string, ParsedAccelerator>();
  let platform: NodeJS.Platform = process.platform;
  let listener: (accelerator: string) => void = () => {};
  let listening = false;
  let running = false;

  const onEvent = (type: "down" | "up", event: UiohookKeyboardEvent) => {
    const keyEvent: GlobalKeyEvent = {
      type,
      keycode: event.keycode,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
    for (const [accelerator, shortcut] of parsed) {
      if (type === "down" && acceleratorIsDown(shortcut, keyEvent)) held.add(accelerator);
      if (held.has(accelerator) && acceleratorReleased(shortcut, keyEvent)) {
        held.delete(accelerator);
        listener(accelerator);
      }
    }
  };

  return {
    start() {
      try {
        if (!listening) {
          listening = true;
          uIOhook.on("keydown", (event) => onEvent("down", event));
          uIOhook.on("keyup", (event) => onEvent("up", event));
        }
        if (!running) {
          uIOhook.start();
          running = true;
        }
        return "ready";
      } catch (error) {
        logger.warn("The key-release hook did not start.", { error: toLogValue(error) });
        return "unavailable";
      }
    },
    stop() {
      held.clear();
      if (!running) return;
      running = false;
      try {
        uIOhook.stop();
      } catch (error) {
        logger.warn("The key-release hook did not stop.", { error: toLogValue(error) });
      }
    },
    setAccelerators(accelerators, nextPlatform) {
      platform = nextPlatform;
      const next = new Map<string, ParsedAccelerator>();
      for (const accelerator of accelerators) {
        const shortcut = parseGlobalVoiceAccelerator(accelerator, platform);
        if (shortcut) next.set(accelerator, shortcut);
      }
      parsed = next;
      for (const accelerator of held) if (!parsed.has(accelerator)) held.delete(accelerator);
    },
    onRelease(next) {
      listener = next;
    },
  };
}
