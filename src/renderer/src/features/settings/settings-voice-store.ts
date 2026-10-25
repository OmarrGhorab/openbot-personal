import {
  ELEVENLABS_VOICE_MODEL_ID,
  type GlobalVoicePreference,
  type GlobalVoiceState,
  isSpeechLanguage,
  type SpeechModelStatus,
  type SpeechSettings,
  type SpeechVoice,
  type VoiceLanguage,
  type VoiceModelId,
  type VoiceModelStatus,
  type VoiceSettings,
} from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { readAloud, stopSpeech } from "../speech/speech-playback";
import { voicePort } from "./voice-port";

interface SettingsVoiceState {
  /** One status for each model in `VOICE_MODELS`, or null before main answers. */
  statuses: Record<VoiceModelId, VoiceModelStatus | null>;
  settings: VoiceSettings | null;
  /** The model that reads replies aloud, and its settings, or null before main answers. */
  speech: { status: SpeechModelStatus | null; settings: SpeechSettings | null; listening: boolean };
  /** The global voice shortcuts and their registration, or null before main answers. */
  globalVoice: GlobalVoiceState | null;
}

const EMPTY_STATUSES: SettingsVoiceState["statuses"] = {
  "parakeet-tdt-0.6b-v3": null,
  "bark-3.0-plus": null,
  "whisper-turbo": null,
  [ELEVENLABS_VOICE_MODEL_ID]: null,
};

type FailureKey =
  | "settings.voice.loadFailed"
  | "settings.voice.saveFailed"
  | "settings.voice.downloadFailed"
  | "settings.voice.cancelFailed"
  | "settings.voice.removeFailed"
  | "settings.voice.apiKey.saveFailed"
  | "settings.voice.apiKey.removeFailed"
  | "settings.voice.speech.listenFailed"
  | "globalVoice.settings.saveFailed";

/**
 * The Voice tab's view of the dictation models and settings. It is created by the settings page,
 * so a download that runs keeps its row while another tab is open.
 */
export function createSettingsVoiceStore(active: () => boolean) {
  const [state, setState] = createStore<SettingsVoiceState>({
    statuses: { ...EMPTY_STATUSES },
    settings: null,
    speech: { status: null, settings: null, listening: false },
    globalVoice: null,
  });
  const setStatus = (status: VoiceModelStatus) =>
    setState((draft) => {
      draft.statuses[status.modelId] = status;
    });

  const setSpeechStatus = (status: SpeechModelStatus) =>
    setState((draft) => {
      draft.speech.status = status;
    });

  // The tab listens only while it is open, and reads every status again each time it opens.
  createEffect(active, (isActive) => {
    if (!isActive) return;
    const voice = voicePort().voice;
    const stopModel = voice.onModelStatus(setStatus);
    const stopSpeechModel = voice.onSpeechModelStatus(setSpeechStatus);
    void Promise.all([
      voice.getModelStatuses(),
      voice.getSettings(),
      voice.getSpeechModelStatus(),
      voice.getSpeechSettings(),
    ])
      .then(([statuses, settings, speechStatus, speechSettings]) => {
        for (const status of statuses) setStatus(status);
        setState((draft) => {
          draft.settings = settings;
          draft.speech.status = speechStatus;
          draft.speech.settings = speechSettings;
        });
      })
      .catch((error: unknown) => fail(error, "settings.voice.loadFailed"));
    void voicePort()
      .globalVoice.getState()
      .then((globalVoice) => {
        setState((draft) => {
          draft.globalVoice = globalVoice;
        });
      })
      .catch(() => {
        // The global shortcut section stays empty until the next time the tab opens.
      });
    return () => {
      stopModel();
      stopSpeechModel();
    };
  });

  /** Saves a change of the global voice preference. The state is what main answers, so a conflict shows. */
  async function saveGlobalVoice(patch: Partial<GlobalVoicePreference>): Promise<void> {
    const current = state.globalVoice;
    if (!current) return;
    try {
      const next = await voicePort().globalVoice.setPreference({ ...current.preference, ...patch });
      setState((draft) => {
        draft.globalVoice = next;
      });
    } catch (error) {
      fail(error, "globalVoice.settings.saveFailed");
    }
  }

  function fail(error: unknown, fallback: FailureKey): void {
    const { t, errorMessage } = currentText();
    toast.error(errorMessage(error, t(fallback)), {
      report: { operation: "settings", source: "system", cause_code: "unknown" },
    });
  }

  function download(modelId: VoiceModelId): void {
    // Progress arrives as status events; the answer is the status when the download ends.
    void voicePort()
      .voice.downloadModel({ modelId })
      .then(setStatus)
      .catch((error: unknown) => fail(error, "settings.voice.downloadFailed"));
  }

  function cancel(modelId: VoiceModelId): void {
    void voicePort()
      .voice.cancelModelDownload({ modelId })
      .then(setStatus)
      .catch((error: unknown) => fail(error, "settings.voice.cancelFailed"));
  }

  /** Deletes a downloaded model from this computer. The model in use downloads again at the next dictation. */
  function remove(modelId: VoiceModelId): void {
    void voicePort()
      .voice.removeModel({ modelId })
      .then(setStatus)
      .catch((error: unknown) => fail(error, "settings.voice.removeFailed"));
  }

  /** Saves or removes the ElevenLabs key. Main keeps the key; the answer is the cloud model's status. */
  function setApiKey(key: string | null): Promise<boolean> {
    return voicePort()
      .voice.setApiKey({ key })
      .then((status) => {
        setStatus(status);
        return true;
      })
      .catch((error: unknown) => {
        fail(error, key === null ? "settings.voice.apiKey.removeFailed" : "settings.voice.apiKey.saveFailed");
        return false;
      });
  }

  function save(patch: Partial<VoiceSettings>): void {
    const current = state.settings;
    if (!current) return;
    const next = { ...current, ...patch };
    setState((draft) => {
      draft.settings = next;
    });
    void voicePort()
      .voice.setSettings(next)
      .then((saved) =>
        setState((draft) => {
          draft.settings = saved;
        }),
      )
      .catch((error: unknown) => {
        setState((draft) => {
          draft.settings = current;
        });
        fail(error, "settings.voice.saveFailed");
      });
  }

  function downloadSpeech(): void {
    const analytics = desktopAnalytics.scope();
    const startedAt = performance.now();
    // A cancelled download ends as "missing".
    const track = (phase: SpeechModelStatus["phase"]) =>
      analytics.track("speech_model_action", {
        action: "download",
        entry_point: "settings",
        result: phase === "ready" ? "succeeded" : "failed",
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(phase === "ready" ? {} : { failure_code: phase === "missing" ? "cancelled" : "download_failed" }),
      });
    void voicePort()
      .voice.downloadSpeechModel()
      .then((status) => {
        track(status.phase);
        setSpeechStatus(status);
      })
      .catch((error: unknown) => {
        track("error");
        fail(error, "settings.voice.downloadFailed");
      });
  }

  function cancelSpeech(): void {
    void voicePort()
      .voice.cancelSpeechModelDownload()
      .then(setSpeechStatus)
      .catch((error: unknown) => fail(error, "settings.voice.cancelFailed"));
  }

  function removeSpeech(): void {
    void voicePort()
      .voice.removeSpeechModel()
      .then(setSpeechStatus)
      .catch((error: unknown) => fail(error, "settings.voice.removeFailed"));
  }

  function saveSpeech(patch: Partial<SpeechSettings>): Promise<boolean> {
    const current = state.speech.settings;
    if (!current) return Promise.resolve(false);
    const next = { ...current, ...patch };
    setState((draft) => {
      draft.speech.settings = next;
    });
    return voicePort()
      .voice.setSpeechSettings(next)
      .then((saved) => {
        setState((draft) => {
          draft.speech.settings = saved;
        });
        return true;
      })
      .catch((error: unknown) => {
        setState((draft) => {
          draft.speech.settings = current;
        });
        fail(error, "settings.voice.saveFailed");
        return false;
      });
  }

  /** Turning it on downloads the model, as the first dictation does. */
  function setReadReplies(readReplies: boolean): void {
    void saveSpeech({ readReplies }).then((saved) => {
      desktopAnalytics.track("speech_settings_action", {
        action: readReplies ? "read_replies_on" : "read_replies_off",
        result: saved ? "succeeded" : "failed",
        ...(saved ? {} : { failure_code: "update_failed" }),
      });
      const phase = state.speech.status?.phase;
      if (saved && readReplies && (phase === "missing" || phase === "error")) downloadSpeech();
    });
  }

  /** Reads a sample in the language of the interface with the voice in the settings. */
  async function listen(sample: string): Promise<void> {
    if (state.speech.listening) {
      stopSpeech();
      return;
    }
    const locale = currentText().locale();
    setState((draft) => {
      draft.speech.listening = true;
    });
    try {
      await readAloud(sample, isSpeechLanguage(locale) ? locale : "en");
    } catch (error) {
      fail(error, "settings.voice.speech.listenFailed");
    } finally {
      setState((draft) => {
        draft.speech.listening = false;
      });
    }
  }

  return {
    state,
    download,
    cancel,
    remove,
    saveApiKey: (key: string) => setApiKey(key),
    removeApiKey: () => setApiKey(null),
    useModel: (modelId: VoiceModelId) => save({ modelId }),
    setLanguage: (language: VoiceLanguage) => save({ language }),
    downloadSpeech,
    cancelSpeech,
    removeSpeech,
    setReadReplies,
    setGlobalVoiceEnabled: (enabled: boolean) => void saveGlobalVoice({ enabled }),
    setGlobalVoiceAccelerator: (accelerator: string) => void saveGlobalVoice({ accelerator }),
    setGlobalVoicePickerAccelerator: (pickerAccelerator: string) => void saveGlobalVoice({ pickerAccelerator }),
    setGlobalVoiceSendAfterSpeaking: (sendAfterSpeaking: boolean) => void saveGlobalVoice({ sendAfterSpeaking }),
    setSpeechVoice: (voice: SpeechVoice) =>
      void saveSpeech({ voice }).then((saved) =>
        desktopAnalytics.track("speech_settings_action", {
          action: "voice_changed",
          result: saved ? "succeeded" : "failed",
          voice,
          ...(saved ? {} : { failure_code: "update_failed" }),
        }),
      ),
    listen,
  };
}

export type SettingsVoiceStore = ReturnType<typeof createSettingsVoiceStore>;
