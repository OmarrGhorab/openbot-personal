import { defineMessages } from "../../message";

export const messages = defineMessages("globalVoice", {
  // The picker window that a global voice shortcut opens over the app the user works in.
  "globalVoice.picker.label": "Voice to an agent",
  "globalVoice.picker.search": "Find an agent",
  "globalVoice.picker.searchPlaceholder": "Type an agent name",
  "globalVoice.picker.list": "Agents",
  "globalVoice.picker.empty": "No agent matches.",
  "globalVoice.picker.noAgents": "No agent on this computer yet.",
  "globalVoice.picker.hintChoose": "Enter or a number chooses. Escape closes.",
  "globalVoice.picker.hintListening": "Press the shortcut again or Enter to send. Escape cancels.",
  "globalVoice.picker.hintReview": "Check the message. Enter sends it. Escape closes.",
  "globalVoice.picker.preparing": "Getting the microphone ready",
  "globalVoice.picker.downloading": "Downloading the voice model, {percent}%. This happens once.",
  "globalVoice.picker.listening": "Listening to {agent}",
  "globalVoice.picker.transcribing": "Writing down what you said",
  "globalVoice.picker.sending": "Sending to {agent}",
  "globalVoice.picker.sent": "Sent to {agent}",
  "globalVoice.picker.transcriptLabel": "Message to {agent}",
  "globalVoice.picker.transcriptPlaceholder": "The message appears here",
  "globalVoice.picker.noSpeech": "No speech was heard. Try again.",
  "globalVoice.picker.dictationFailed": "Dictation failed. Try again.",
  "globalVoice.picker.sendFailed": "The message was not sent. It is still here, so you can send it again.",

  // Settings > Voice: the global shortcut of the picker and the send setting.
  "globalVoice.settings.title": "Global voice shortcut",
  "globalVoice.settings.enabled.title": "Use the global shortcuts",
  "globalVoice.settings.enabled.description":
    "When off, no global voice shortcut works, including the agent shortcuts.",
  "globalVoice.settings.dictation.title": "Dictation shortcut",
  "globalVoice.settings.dictation.description":
    "Starts dictation to the current agent at once. Press it again to send. Tab changes the agent while it listens; Escape cancels.",
  "globalVoice.settings.picker.title": "Agent picker shortcut",
  "globalVoice.settings.picker.description": "Opens the list of agents to choose the one that gets the message.",
  "globalVoice.settings.sendAfterSpeaking.title": "Send after speaking",
  "globalVoice.settings.sendAfterSpeaking.description":
    "When you stop, the message goes to the agent. Off keeps it in the picker, so you can check it first.",
  "globalVoice.settings.record": "Press the new keys…",
  "globalVoice.settings.recordLabel": "Change the shortcut for {name}",
  "globalVoice.settings.recordHint":
    "Press a key, or a modifier (Option, Control, Shift or Cmd) with a key. F1 to F12 work alone. Escape cancels.",
  "globalVoice.settings.change": "Change",
  "globalVoice.settings.cancel": "Cancel",
  "globalVoice.settings.bareKeyWarning":
    "This key alone stops typing in other apps while OpenBot runs. F1 to F12 are safer.",
  "globalVoice.settings.reset": "Reset",
  "globalVoice.settings.turnOff": "Turn off",
  "globalVoice.settings.keyNotAllowed": "This key cannot start a shortcut.",
  "globalVoice.settings.takenWarning":
    "Another app or shortcut already uses {accelerator}. Pick another key, or the shortcut does nothing.",
  "globalVoice.settings.saveFailed": "The shortcut was not saved. Try again.",

  // The agent settings: a direct shortcut that starts dictation to one agent.
  "globalVoice.agent.title": "Global voice shortcut",
  "globalVoice.agent.description": "Starts dictation to this agent from any app, without the picker.",
  "globalVoice.agent.none": "None",
  "globalVoice.agent.saveFailed": "The shortcut was not saved. Try again.",
  "globalVoice.agent.disabledHint": "Turn on the global voice shortcuts in Settings > Voice to use it.",
});
