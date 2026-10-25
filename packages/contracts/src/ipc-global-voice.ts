import { type AvatarHue, isAvatarHue, isAvatarSeed } from "./ipc-agent-identity";
import { type DynamicRecord, isDynamicRecord } from "./runtime-values";

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
 * Whether the text is an Electron accelerator that a global shortcut can use: one or more modifiers
 * and one key. A key with no modifier is rejected. A global V would swallow typing in every other app.
 */
export function isGlobalVoiceAccelerator(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > GLOBAL_VOICE_LIMITS.acceleratorLength) {
    return false;
  }
  const parts = value.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  if (modifiers.length === 0) return false;
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

/** Hold records while the key is down. Toggle records from one press to the next. */
export type GlobalVoiceCaptureMode = "hold" | "toggle";

export interface GlobalVoicePreference {
  /** Whether the global shortcuts are registered at all. */
  enabled: boolean;
  /** Starts dictation to the current agent. In hold mode, releasing the key sends. */
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
  /** How the dictation shortcut records. A saved file without this field means hold. */
  captureMode: GlobalVoiceCaptureMode;
  /**
   * The agent the dictation shortcut uses. Null uses the last agent that got a message, then the
   * most recent agent. A saved file without this field means null.
   */
  defaultAgentId: string | null;
}

export const DEFAULT_GLOBAL_VOICE_PREFERENCE: GlobalVoicePreference = {
  enabled: true,
  accelerator: GLOBAL_VOICE_DEFAULT_ACCELERATOR,
  pickerAccelerator: GLOBAL_VOICE_DEFAULT_PICKER_ACCELERATOR,
  sendAfterSpeaking: true,
  agentShortcuts: [],
  captureMode: "hold",
  defaultAgentId: null,
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
  /** Whether hold-to-talk can see the key go up. */
  keyRelease: GlobalVoiceKeyRelease;
  microphone: GlobalVoiceMicrophoneAccess;
}

/** The window asks main to take or ignore pointer and key events over the island. */
export interface GlobalVoiceInteractiveInput {
  interactive: boolean;
  keyboard: boolean;
}

/** The agent whose chat the confirmation opens. */
export interface GlobalVoiceAgentFocus {
  agentId: string;
}

/** An agent the picker lists. Only agents on this computer, most recent first. */
export interface GlobalVoicePickerAgent {
  agentId: string;
  name: string;
  title: string;
  /** ISO 8601 time of the agent's last activity, or null when it has none. */
  updatedAt: string | null;
  /** The same avatar the sidebar draws: the generated mascot from the seed and hue, or the uploaded image. */
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
}

/**
 * What the window does with an agent: dictate to it (a second press sends), or choose one in the
 * picker first.
 */
export type GlobalVoicePickerRequest = { type: "choose" } | { type: "agent"; agentId: string };

/**
 * A command main sends to the open window.
 * `release` is the key going up. The window sends on release only while hold-to-talk is active.
 */
export type GlobalVoiceCommand =
  | GlobalVoicePickerRequest
  | { type: "cancel" }
  | { type: "release"; source: "dictation" | "picker" | "agent" };

/** Whether the key-release hook can see the key go up. macOS needs Accessibility for hold-to-talk. */
export type GlobalVoiceKeyRelease = "ready" | "needs-accessibility" | "unavailable";

/** The microphone grant. `unknown` means this computer asks at the first recording. */
export type GlobalVoiceMicrophoneAccess = "granted" | "denied" | "unknown";

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
  captureMode: GlobalVoiceCaptureMode;
  /** True only when the saved mode is hold and the key-release hook is running. */
  holdToTalk: boolean;
  keyRelease: GlobalVoiceKeyRelease;
}

export interface GlobalVoiceSendInput {
  agentId: string;
  text: string;
}

const GLOBAL_VOICE_SHORTCUT_STATUSES: readonly GlobalVoiceShortcutStatus[] = ["active", "taken", "disabled"];
const GLOBAL_VOICE_VIEWS: readonly GlobalVoiceView[] = ["hidden", "pill", "picker"];
const GLOBAL_VOICE_KEY_RELEASE: readonly GlobalVoiceKeyRelease[] = ["ready", "needs-accessibility", "unavailable"];
const GLOBAL_VOICE_MICROPHONE: readonly GlobalVoiceMicrophoneAccess[] = ["granted", "denied", "unknown"];
const GLOBAL_VOICE_AGENT_ID_LENGTH = 128;

/**
 * Checks a global voice preference and returns a copy of it, or null when any field is wrong. Main
 * uses it for the IPC payload and the saved file; the preload uses it for what main answers.
 */
export function toGlobalVoicePreference(value: unknown): GlobalVoicePreference | null {
  if (!isDynamicRecord(value)) return null;
  const { enabled, accelerator, pickerAccelerator, sendAfterSpeaking, agentShortcuts } = value;
  const captureMode = readCaptureMode(value);
  const defaultAgentId = readDefaultAgentId(value);
  if (
    typeof enabled !== "boolean" ||
    typeof sendAfterSpeaking !== "boolean" ||
    captureMode === null ||
    defaultAgentId === undefined ||
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
  return {
    enabled,
    accelerator,
    pickerAccelerator,
    sendAfterSpeaking,
    agentShortcuts: shortcuts,
    captureMode,
    defaultAgentId,
  };
}

/** A file written before hold-to-talk has no mode. It means hold. A wrong value is rejected. */
function readCaptureMode(value: DynamicRecord): GlobalVoiceCaptureMode | null {
  if (!("captureMode" in value)) return "hold";
  return value.captureMode === "hold" || value.captureMode === "toggle" ? value.captureMode : null;
}

/** A file written before the default agent has no id. It means the last agent that got a message. */
function readDefaultAgentId(value: DynamicRecord): string | null | undefined {
  if (!("defaultAgentId" in value) || value.defaultAgentId === null) return null;
  return isGlobalVoiceAgentId(value.defaultAgentId) ? value.defaultAgentId : undefined;
}

/** Checks what main answers for the Settings: the saved preference and each shortcut's registration. */
export function isGlobalVoiceState(value: unknown): value is GlobalVoiceState {
  if (!isDynamicRecord(value) || toGlobalVoicePreference(value.preference) === null) return false;
  if (!new Set<unknown>(GLOBAL_VOICE_KEY_RELEASE).has(value.keyRelease)) return false;
  if (!new Set<unknown>(GLOBAL_VOICE_MICROPHONE).has(value.microphone)) return false;
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
    (value.captureMode === "hold" || value.captureMode === "toggle") &&
    typeof value.holdToTalk === "boolean" &&
    new Set<unknown>(GLOBAL_VOICE_KEY_RELEASE).has(value.keyRelease) &&
    Array.isArray(value.agents) &&
    value.agents.every(
      (agent) =>
        isDynamicRecord(agent) &&
        isGlobalVoiceAgentId(agent.agentId) &&
        typeof agent.name === "string" &&
        typeof agent.title === "string" &&
        (agent.updatedAt === null || typeof agent.updatedAt === "string") &&
        isAvatarSeed(agent.avatarSeed) &&
        (agent.avatarHue === null || isAvatarHue(agent.avatarHue)) &&
        (agent.avatarUrl === null || typeof agent.avatarUrl === "string"),
    )
  );
}

export function isGlobalVoicePickerRequest(value: unknown): value is GlobalVoicePickerRequest {
  if (!isDynamicRecord(value)) return false;
  if (value.type === "choose") return true;
  return value.type === "agent" && isGlobalVoiceAgentId(value.agentId);
}

export function isGlobalVoiceCommand(value: unknown): value is GlobalVoiceCommand {
  if (!isDynamicRecord(value)) return false;
  if (value.type === "cancel") return true;
  if (value.type === "release")
    return value.source === "dictation" || value.source === "picker" || value.source === "agent";
  return isGlobalVoicePickerRequest(value);
}

export function isGlobalVoiceInteractiveInput(value: unknown): value is GlobalVoiceInteractiveInput {
  return isDynamicRecord(value) && typeof value.interactive === "boolean" && typeof value.keyboard === "boolean";
}

export function isGlobalVoiceAgentFocus(value: unknown): value is GlobalVoiceAgentFocus {
  return isDynamicRecord(value) && isGlobalVoiceAgentId(value.agentId);
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
