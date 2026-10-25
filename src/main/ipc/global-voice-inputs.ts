import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  GLOBAL_VOICE_LIMITS,
  type GlobalVoiceAgentFocus,
  type GlobalVoiceInteractiveInput,
  type GlobalVoicePreference,
  type GlobalVoiceSendInput,
  type GlobalVoiceViewState,
  isGlobalVoiceAgentFocus,
  isGlobalVoiceInteractiveInput,
  isGlobalVoiceViewState,
  toGlobalVoicePreference,
} from "@openbot/contracts/ipc";
import { isObject, requireString } from "./validation";

export function parseGlobalVoiceCapturing(input: unknown): boolean {
  if (typeof input !== "boolean") throw new Error("Global voice capture state is invalid.");
  return input;
}

export function parseGlobalVoicePreference(input: unknown): GlobalVoicePreference {
  const preference = toGlobalVoicePreference(input);
  if (!preference) throw new Error("Global voice preference is invalid.");
  return preference;
}

export function parseGlobalVoiceSendInput(input: unknown): GlobalVoiceSendInput {
  if (!isObject(input)) throw new Error("Global voice transcript is required.");
  return {
    agentId: requireString(input.agentId, "agentId", INPUT_LIMITS.identifier),
    text: requireString(input.text, "text", GLOBAL_VOICE_LIMITS.transcriptLength),
  };
}

export function parseGlobalVoiceViewState(input: unknown): GlobalVoiceViewState {
  if (!isGlobalVoiceViewState(input)) throw new Error("Global voice view is invalid.");
  return input;
}

export function parseGlobalVoiceInteractiveInput(input: unknown): GlobalVoiceInteractiveInput {
  if (!isGlobalVoiceInteractiveInput(input)) throw new Error("Global voice pointer state is invalid.");
  return input;
}

export function parseGlobalVoiceAgentFocus(input: unknown): GlobalVoiceAgentFocus {
  if (!isGlobalVoiceAgentFocus(input)) throw new Error("Global voice agent is invalid.");
  return input;
}
