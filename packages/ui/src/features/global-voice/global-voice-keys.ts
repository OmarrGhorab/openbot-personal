/** A key press turned into an accelerator, or the reason it cannot be one. */
export type GlobalVoiceKeyResult = { accelerator: string } | { error: "keyNotAllowed" | "modifierRequired" };

type KeyboardKeys = Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
  /** Present on a real event. A test can omit it. Option on a Mac can set this when `altKey` is false. */
  getModifierState?: ((key: string) => boolean) | undefined;
};

/** Keys that name themselves in an accelerator, by their `KeyboardEvent.code`. */
const NAMED_KEYS: Record<string, string> = {
  Space: "Space",
  Tab: "Tab",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

/**
 * The accelerator of a key press, read from its physical key (`code`), so a Mac's Option layer
 * does not change the letter. Returns null while only modifiers are held. A key with no modifier
 * is refused: it would swallow that key in every other app. Option is read from `altKey` and from
 * `getModifierState`, because a Mac can report Option in only one of them.
 */
export function globalVoiceAcceleratorFromKeyboard(keys: KeyboardKeys, isMac: boolean): GlobalVoiceKeyResult | null {
  const key = keyFromCode(keys.code);
  if (key === null) return null;
  if (key === undefined) return { error: "keyNotAllowed" };
  const modifiers: string[] = [];
  if (modifierDown(keys, "Meta", keys.metaKey)) modifiers.push(isMac ? "Command" : "Super");
  if (modifierDown(keys, "Control", keys.ctrlKey)) modifiers.push("Control");
  if (modifierDown(keys, "Alt", keys.altKey)) modifiers.push("Alt");
  if (modifierDown(keys, "Shift", keys.shiftKey)) modifiers.push("Shift");
  if (modifiers.length === 0) return { error: "modifierRequired" };
  return { accelerator: [...modifiers, key].join("+") };
}

function modifierDown(keys: KeyboardKeys, name: "Alt" | "Control" | "Meta" | "Shift", flag: boolean): boolean {
  if (flag) return true;
  return keys.getModifierState?.(name) ?? false;
}

/** True for a letter, digit or Space with no modifier: a global shortcut on it stops that key in every app. */
export function isBareTypingKey(accelerator: string): boolean {
  return /^([A-Z0-9]|Space|Tab|Enter|Backspace)$/.test(accelerator);
}

/** The key name for a code: null for a modifier alone, undefined for a key that cannot be a shortcut. */
function keyFromCode(code: string): string | null | undefined {
  if (code === "" || /^(Shift|Control|Alt|Meta|OS|AltGraph)(Left|Right)?$/.test(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED_KEYS[code];
}

/** The accelerator as the user reads it: symbols on a Mac, words elsewhere. */
export function formatGlobalVoiceAccelerator(accelerator: string, isMac: boolean): string {
  const parts = accelerator.split("+").map((part) => {
    if (part === "CommandOrControl") return isMac ? "⌘" : "Ctrl";
    if (part === "Command") return "⌘";
    if (part === "Super") return isMac ? "⌘" : "Win";
    if (part === "Control") return isMac ? "⌃" : "Ctrl";
    if (part === "Alt") return isMac ? "⌥" : "Alt";
    if (part === "Shift") return isMac ? "⇧" : "Shift";
    if (part === "Up") return "↑";
    if (part === "Down") return "↓";
    if (part === "Left") return "←";
    if (part === "Right") return "→";
    return part;
  });
  return isMac ? parts.join("") : parts.join("+");
}

/** The keys of an accelerator as keycap labels, each with its symbol and name: "⌥ Option", "V". */
export function globalVoiceAcceleratorKeys(accelerator: string, isMac: boolean): string[] {
  return accelerator.split("+").map((part) => {
    if (part === "CommandOrControl") return isMac ? "⌘ Cmd" : "Ctrl";
    if (part === "Command") return "⌘ Cmd";
    if (part === "Super") return isMac ? "⌘ Cmd" : "Win";
    if (part === "Control") return isMac ? "⌃ Control" : "Ctrl";
    if (part === "Alt") return isMac ? "⌥ Option" : "Alt";
    if (part === "Shift") return isMac ? "⇧ Shift" : "Shift";
    if (part === "Up") return "↑";
    if (part === "Down") return "↓";
    if (part === "Left") return "←";
    if (part === "Right") return "→";
    return part;
  });
}

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
