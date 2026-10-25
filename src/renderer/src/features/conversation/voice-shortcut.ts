/** The key that starts and stops dictation in the composer. The shortcut is the bare key, so it works only with no modifier. */
export const VOICE_SHORTCUT_KEY = "V";

/** Input types that take no typed text, so a focused one does not keep the key. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether the keydown is the dictation key: V with no Command, Control, Alt or Shift. Caps Lock
 * does not count as Shift. Holding the key sends repeats, which must not start and stop the recording.
 */
export function isVoiceShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat" | "isComposing">,
): boolean {
  return (
    event.key?.toLocaleLowerCase() === VOICE_SHORTCUT_KEY.toLocaleLowerCase() &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.isComposing
  );
}

/** Whether the target takes typed text, so the key belongs to the text and not to dictation. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
