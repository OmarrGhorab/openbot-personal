/** A key press turned into an accelerator, or the reason it cannot be one. */
export type GlobalVoiceKeyResult = { accelerator: string } | { error: "needsModifier" | "keyNotAllowed" };

type KeyboardKeys = Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

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
 * does not change the letter. Returns null while only modifiers are held. Keys that cannot start a
 * shortcut, and a key with no modifier, return an error.
 */
export function globalVoiceAcceleratorFromKeyboard(keys: KeyboardKeys, isMac: boolean): GlobalVoiceKeyResult | null {
  const key = keyFromCode(keys.code);
  if (key === null) return null;
  if (key === undefined) return { error: "keyNotAllowed" };
  const modifiers: string[] = [];
  if (keys.metaKey) modifiers.push(isMac ? "Command" : "Super");
  if (keys.ctrlKey) modifiers.push("Control");
  if (keys.altKey) modifiers.push("Alt");
  if (keys.shiftKey) modifiers.push("Shift");
  if (modifiers.length === 0) return { error: "needsModifier" };
  return { accelerator: [...modifiers, key].join("+") };
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

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
