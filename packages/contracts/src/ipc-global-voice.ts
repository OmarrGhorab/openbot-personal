import { isDynamicRecord } from "./runtime-values";

// The global voice shortcuts. The dictation shortcut works while OpenBot is in the background: it
// starts dictation at once to the current agent, and pressing it again sends the text. A second
// shortcut opens a picker of agents. While the dictation runs, Tab opens the picker and Escape
// cancels. Saved in `global-voice-preference.json`; never rename the file or a field.

/**
 * The dictation shortcut: Option+V on macOS (Alt+V on a PC keyboard). A key without a modifier is
 * not offered: a global V would stop the letter in every other app. Not Alt+Space: on macOS that
 * types a no-break space in every other app, and on Windows it opens the system menu.
 */
export const GLOBAL_VOICE_DEFAULT_ACCELERATOR = "Alt+V";
/** The shortcut that opens the agent picker: Option+K, or Alt+K on a PC keyboard. */
export const GLOBAL_VOICE_DEFAULT_PICKER_ACCELERATOR = "Alt+K";

export const GLOBAL_VOICE_LIMITS = {
  /** Direct shortcuts, one for each agent at most. */
  agentShortcuts: 100,
  /** Longest accelerator text that main keeps. */
  acceleratorLength: 64,
  /** Longest dictated message that main sends. */
  transcriptLength: 20_000,
} as const;

const GLOBAL_VOICE_MODIFIERS = ["CommandOrControl", "Command", "Control", "Alt", "Shift", "Super"] as const;
const GLOBAL_VOICE_KEYS = [
  "Space",
  "Tab",
  "Enter",
  "Backspace",
  "Delete",
  "Insert",
  "Up",
  "Down",
  "Left",
  "Right",
  "Home",
  "End",
  "PageUp",
  "PageDown",
] as const;

/**
 * Whether the text is an Electron accelerator that a global shortcut can use: modifiers, if any,
 * and one key. A key with no modifier is allowed because the owner chose it; the settings warn
 * that it then stops typing that key in every other app.
 */
export function isGlobalVoiceAccelerator(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > GLOBAL_VOICE_LIMITS.acceleratorLength) {
    return false;
  }
  const parts = value.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  if (new Set(modifiers).size !== modifiers.length) return false;
  if (!modifiers.every((modifier) => new Set<string>(GLOBAL_VOICE_MODIFIERS).has(modifier))) return false;
  return isGlobalVoiceKey(key);
}

function isGlobalVoiceKey(key: string): boolean {
  if (/^[A-Z0-9]$/.test(key)) return true;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return true;
  return new Set<string>(GLOBAL_VOICE_KEYS).has(key);
}

export interface GlobalVoiceAgentShortcut {
  agentId: string;
  accelerator: string;
}

export interface GlobalVoicePreference {
  /** Whether the global shortcuts are registered at all. */
  enabled: boolean;
  /** Starts dictation to the current agent; pressed again, it sends. */
  accelerator: string;
  /** Opens the agent picker. */
  pickerAccelerator: string;
  /**
   * Whether the text goes to the agent when dictation stops. Off keeps it in the pill, where the user
   * presses Enter to send.
   */
  sendAfterSpeaking: boolean;
  /** Direct shortcuts: each one starts dictation to one agent. */
  agentShortcuts: GlobalVoiceAgentShortcut[];
}

export const DEFAULT_GLOBAL_VOICE_PREFERENCE: GlobalVoicePreference = {
  enabled: true,
  accelerator: GLOBAL_VOICE_DEFAULT_ACCELERATOR,
  pickerAccelerator: GLOBAL_VOICE_DEFAULT_PICKER_ACCELERATOR,
  sendAfterSpeaking: true,
  agentShortcuts: [],
};

/** What a global shortcut does: start dictation to the current agent, open the picker, or dictate to one agent. */
export type GlobalVoiceShortcutTarget = { type: "dictation" } | { type: "picker" } | { type: "agent"; agentId: string };

/**
 * `active`: registered. `taken`: another app or another shortcut already holds the combination, so
 * it does nothing. `disabled`: the global shortcuts are off.
 */
export type GlobalVoiceShortcutStatus = "active" | "taken" | "disabled";

export interface GlobalVoiceShortcutState {
  target: GlobalVoiceShortcutTarget;
  accelerator: string;
  status: GlobalVoiceShortcutStatus;
}

export interface GlobalVoiceState {
  preference: GlobalVoicePreference;
  shortcuts: GlobalVoiceShortcutState[];
}

/** An agent the picker lists. Only agents on this computer, most recent first. */
export interface GlobalVoicePickerAgent {
  agentId: string;
  name: string;
  title: string;
  /** ISO 8601 time of the agent's last activity, or null when it has none. */
  updatedAt: string | null;
}

/**
 * What the window does with an agent: dictate to it (a second press sends), or choose one in the
 * picker first.
 */
export type GlobalVoicePickerRequest = { type: "choose" } | { type: "agent"; agentId: string };

/** A command main sends to the open window: a request, or Escape while the dictation listens. */
export type GlobalVoiceCommand = GlobalVoicePickerRequest | { type: "cancel" };

/** What the window shows: the pill beside the work, the picker, or nothing. */
export type GlobalVoiceView = "hidden" | "pill" | "picker";

export interface GlobalVoiceViewState {
  view: GlobalVoiceView;
  /** Whether the dictation listens. Main registers Tab and Escape globally only while it does. */
  listening: boolean;
}

export interface GlobalVoicePickerSnapshot {
  /** Changes for each opening, so the window does not reset a dictation that is running. */
  id: number;
  request: GlobalVoicePickerRequest;
  /** The agent that dictation goes to when the window opens, or null when none is known. */
  currentAgentId: string | null;
  agents: GlobalVoicePickerAgent[];
  sendAfterSpeaking: boolean;
}

export interface GlobalVoiceSendInput {
  agentId: string;
  text: string;
}

const GLOBAL_VOICE_SHORTCUT_STATUSES: readonly GlobalVoiceShortcutStatus[] = ["active", "taken", "disabled"];
const GLOBAL_VOICE_VIEWS: readonly GlobalVoiceView[] = ["hidden", "pill", "picker"];
const GLOBAL_VOICE_AGENT_ID_LENGTH = 128;

/**
 * Checks a global voice preference and returns a copy of it, or null when any field is wrong. Main
 * uses it for the IPC payload and the saved file; the preload uses it for what main answers.
 */
export function toGlobalVoicePreference(value: unknown): GlobalVoicePreference | null {
  if (!isDynamicRecord(value)) return null;
  const { enabled, accelerator, pickerAccelerator, sendAfterSpeaking, agentShortcuts } = value;
  if (
    typeof enabled !== "boolean" ||
    typeof sendAfterSpeaking !== "boolean" ||
    !isGlobalVoiceAccelerator(accelerator) ||
    !isGlobalVoiceAccelerator(pickerAccelerator) ||
    !Array.isArray(agentShortcuts) ||
    agentShortcuts.length > GLOBAL_VOICE_LIMITS.agentShortcuts
  ) {
    return null;
  }
  const agentIds = new Set<string>();
  const shortcuts: GlobalVoiceAgentShortcut[] = [];
  for (const shortcut of agentShortcuts) {
    if (!isDynamicRecord(shortcut)) return null;
    const { agentId, accelerator: shortcutAccelerator } = shortcut;
    if (!isGlobalVoiceAgentId(agentId) || !isGlobalVoiceAccelerator(shortcutAccelerator) || agentIds.has(agentId)) {
      return null;
    }
    agentIds.add(agentId);
    shortcuts.push({ agentId, accelerator: shortcutAccelerator });
  }
  return { enabled, accelerator, pickerAccelerator, sendAfterSpeaking, agentShortcuts: shortcuts };
}

/** Checks what main answers for the Settings: the saved preference and each shortcut's registration. */
export function isGlobalVoiceState(value: unknown): value is GlobalVoiceState {
  if (!isDynamicRecord(value) || toGlobalVoicePreference(value.preference) === null) return false;
  return (
    Array.isArray(value.shortcuts) &&
    value.shortcuts.every(
      (shortcut) =>
        isDynamicRecord(shortcut) &&
        isGlobalVoiceShortcutTarget(shortcut.target) &&
        isGlobalVoiceAccelerator(shortcut.accelerator) &&
        new Set<unknown>(GLOBAL_VOICE_SHORTCUT_STATUSES).has(shortcut.status),
    )
  );
}

export function isGlobalVoicePickerSnapshot(value: unknown): value is GlobalVoicePickerSnapshot {
  return (
    isDynamicRecord(value) &&
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    isGlobalVoicePickerRequest(value.request) &&
    (value.currentAgentId === null || isGlobalVoiceAgentId(value.currentAgentId)) &&
    typeof value.sendAfterSpeaking === "boolean" &&
    Array.isArray(value.agents) &&
    value.agents.every(
      (agent) =>
        isDynamicRecord(agent) &&
        isGlobalVoiceAgentId(agent.agentId) &&
        typeof agent.name === "string" &&
        typeof agent.title === "string" &&
        (agent.updatedAt === null || typeof agent.updatedAt === "string"),
    )
  );
}

export function isGlobalVoicePickerRequest(value: unknown): value is GlobalVoicePickerRequest {
  if (!isDynamicRecord(value)) return false;
  if (value.type === "choose") return true;
  return value.type === "agent" && isGlobalVoiceAgentId(value.agentId);
}

export function isGlobalVoiceCommand(value: unknown): value is GlobalVoiceCommand {
  if (isDynamicRecord(value) && value.type === "cancel") return true;
  return isGlobalVoicePickerRequest(value);
}

export function isGlobalVoiceShortcutTarget(value: unknown): value is GlobalVoiceShortcutTarget {
  if (!isDynamicRecord(value)) return false;
  if (value.type === "dictation" || value.type === "picker") return true;
  return value.type === "agent" && isGlobalVoiceAgentId(value.agentId);
}

export function isGlobalVoiceViewState(value: unknown): value is GlobalVoiceViewState {
  return (
    isDynamicRecord(value) &&
    new Set<unknown>(GLOBAL_VOICE_VIEWS).has(value.view) &&
    typeof value.listening === "boolean"
  );
}

function isGlobalVoiceAgentId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= GLOBAL_VOICE_AGENT_ID_LENGTH;
}
