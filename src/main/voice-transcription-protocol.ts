// The messages between the main process and the voice transcription host.
//
// Type-only: the host imports nothing from here at runtime, so it stays free of application code.

/** `nemo-transducer` is Parakeet or Bark; `nemo-ctc` is FastConformer Arabic; `whisper` is Whisper turbo or small. */
export type VoiceTranscriptionEngine = "nemo-transducer" | "nemo-ctc" | "whisper";

export interface VoiceTranscriptionRequest {
  id: number;
  /** Absolute path of `sherpa-onnx.node`. */
  addonPath: string;
  /** The directory with the files of the model. */
  modelDirectory: string;
  engine: VoiceTranscriptionEngine;
  /** A Whisper language code, or an empty string to let the model find the language. */
  language: string;
  /**
   * With automatic language, the Whisper language for a phrase detected as neither Arabic nor
   * English. Empty or missing keeps what Whisper found.
   */
  fallbackLanguage?: string;
  /** The number of silent samples the host puts before the audio. */
  leadingSilenceSamples: number;
  /** Loads the model, without decoding anything, so the first real request starts at inference. */
  warm?: boolean;
  /** Little-endian 16-bit mono PCM at 16 kHz: the data chunk of the validated WAV file. */
  pcm: Uint8Array;
}

/**
 * Why a request failed. Only the category crosses the process boundary: the addon's own message
 * can contain paths, and the main process maps the category to a localized error.
 */
export type VoiceTranscriptionFailure = "runtime-unavailable" | "model-load-failed" | "inference-failed";

export type VoiceTranscriptionResponse =
  | { id: number; text: string }
  | { id: number; error: VoiceTranscriptionFailure };

export interface VoiceTranscriptionHostProcess {
  send(request: VoiceTranscriptionRequest): void;
  onResponse(listener: (response: VoiceTranscriptionResponse) => void): void;
  /** The host ended, asked or not. */
  onExit(listener: () => void): void;
  /** End it now, whatever it is in the middle of. */
  kill(): void;
}
