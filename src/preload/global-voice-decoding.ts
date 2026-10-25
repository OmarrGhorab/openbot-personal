// What main answers for the global voice shortcuts and the window: the saved state, the snapshot
// the window opens with and the commands main sends it. Each decoder checks the whole value before
// the renderer reads it.

import {
  type GlobalVoiceAgentFocus,
  type GlobalVoiceCommand,
  type GlobalVoicePickerSnapshot,
  type GlobalVoiceState,
  isGlobalVoiceAgentFocus,
  isGlobalVoiceCommand,
  isGlobalVoicePickerSnapshot,
  isGlobalVoiceState,
} from "@openbot/contracts/ipc";

export function decodeGlobalVoiceState(value: unknown): GlobalVoiceState {
  if (!isGlobalVoiceState(value)) throw new Error("Invalid global voice state response.");
  return value;
}

export function decodeGlobalVoicePickerSnapshot(value: unknown): GlobalVoicePickerSnapshot {
  if (!isGlobalVoicePickerSnapshot(value)) throw new Error("Invalid global voice picker snapshot.");
  return value;
}

export function decodeNullableGlobalVoicePickerSnapshot(value: unknown): GlobalVoicePickerSnapshot | null {
  if (value === null) return null;
  return decodeGlobalVoicePickerSnapshot(value);
}

export function decodeGlobalVoiceCommand(value: unknown): GlobalVoiceCommand {
  if (!isGlobalVoiceCommand(value)) throw new Error("Invalid global voice command.");
  return value;
}

export function decodeGlobalVoiceAgentFocus(value: unknown): GlobalVoiceAgentFocus {
  if (!isGlobalVoiceAgentFocus(value)) throw new Error("Invalid global voice agent.");
  return value;
}
