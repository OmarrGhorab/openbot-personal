// The global voice shortcuts (Settings) and the window (helper surface): its snapshot, the transcript
// it sends, its view and its close request. The window's requests need the window's own sender.

import type { GlobalVoiceState } from "@openbot/contracts/ipc";
import type { IpcMainInvokeEvent } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { type GlobalVoiceController, requireGlobalVoicePickerSender } from "../global-voice-window";
import { authorizedHandler, eventHandler, handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseGlobalVoiceAgentFocus,
  parseGlobalVoiceInteractiveInput,
  parseGlobalVoicePreference,
  parseGlobalVoiceSendInput,
  parseGlobalVoiceViewState,
} from "./global-voice-inputs";

export interface GlobalVoiceIpcDependencies {
  globalVoice: GlobalVoiceController;
}

export function globalVoiceIpcHandlers({
  globalVoice,
}: GlobalVoiceIpcDependencies): Pick<IpcGroupHandlers, "globalVoice"> {
  const fromPicker = (event: IpcMainInvokeEvent) =>
    requireGlobalVoicePickerSender(event.sender.id, globalVoice.pickerRendererIds);

  return {
    globalVoice: {
      getState: handler((): GlobalVoiceState => globalVoice.getState()),
      setPreference: payloadHandler(parseGlobalVoicePreference, (preference) =>
        runCauseEffect(globalVoice.setPreference(preference)),
      ),
      getPickerSnapshot: eventHandler((event) => {
        fromPicker(event);
        return globalVoice.getPickerSnapshot();
      }),
      sendTranscript: authorizedHandler(fromPicker, parseGlobalVoiceSendInput, (_event, input) =>
        runCauseEffect(globalVoice.sendTranscript(input)),
      ),
      setView: authorizedHandler(fromPicker, parseGlobalVoiceViewState, (_event, state) => {
        globalVoice.setView(state);
      }),
      closePicker: eventHandler((event) => {
        fromPicker(event);
        globalVoice.closePicker();
      }),
      openAccessibilitySettings: handler(() => runCauseEffect(globalVoice.promptAccessibility())),
      openMicrophoneSettings: handler(() => runCauseEffect(globalVoice.promptMicrophone())),
      setInteractive: authorizedHandler(fromPicker, parseGlobalVoiceInteractiveInput, (_event, input) => {
        globalVoice.setInteractive(input);
      }),
      openChat: authorizedHandler(fromPicker, parseGlobalVoiceAgentFocus, (_event, input) => {
        globalVoice.openChat(input.agentId);
      }),
    },
  };
}
