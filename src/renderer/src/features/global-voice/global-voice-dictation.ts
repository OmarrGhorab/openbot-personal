import { VOICE_AUDIO_LIMITS } from "@openbot/contracts/ipc";
import { recordingToWav } from "../../voice-recording";

/** How often the recording so far is transcribed again for the live text. */
const LIVE_INTERVAL_MS = 1_500;

export class GlobalVoiceDictationError extends Error {
  readonly kind: "unavailable" | "noSpeech" | "failed";

  constructor(kind: "unavailable" | "noSpeech" | "failed", message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * One dictation in the window: the microphone, the live text while the user speaks, and the final
 * text after Stop. The model and the language are the saved voice settings, read by main, so
 * Arabic and English work as they do in the chat.
 */
export class GlobalVoiceDictation {
  #recorder: MediaRecorder | null = null;
  #stream: MediaStream | null = null;
  #chunks: Blob[] = [];
  #limitTimer: ReturnType<typeof setTimeout> | undefined;
  #liveTimer: ReturnType<typeof setInterval> | undefined;
  #liveRequest: Promise<void> = Promise.resolve();
  #onLimit: () => void = () => {};
  #onLive: (text: string) => void = () => {};

  /** Opens the microphone and starts recording. `onLimit` runs when the time limit is reached. */
  async start(callbacks: { onLive: (text: string) => void; onLimit: () => void }): Promise<void> {
    this.#onLive = callbacks.onLive;
    this.#onLimit = callbacks.onLimit;
    const status = await window.openbot.voice.prepareModel();
    if (status.phase !== "ready") {
      throw new GlobalVoiceDictationError("unavailable", status.message ?? "");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const recorder = new MediaRecorder(stream);
    this.#stream = stream;
    this.#recorder = recorder;
    this.#chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    });
    recorder.start(1_000);
    this.#limitTimer = setTimeout(() => this.#onLimit(), VOICE_AUDIO_LIMITS.maximumSeconds * 1_000);
    this.#liveTimer = setInterval(() => {
      this.#liveRequest = this.#liveRequest.then(() => this.#refreshLive());
    }, LIVE_INTERVAL_MS);
  }

  /** Stops the microphone and returns the text. Throws when no speech was heard. */
  async stop(): Promise<string> {
    const recorder = this.#recorder;
    if (!recorder) throw new GlobalVoiceDictationError("failed", "");
    // No live text arrives after Stop: the final text replaces it.
    this.#recorder = null;
    this.#clearTimers();
    if (recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.#release();
    // The live pass and the final pass cannot run at once: main takes one transcription at a time.
    await this.#liveRequest;
    if (this.#chunks.length === 0) throw new GlobalVoiceDictationError("noSpeech", "");
    const audio = await recordingToWav(new Blob(this.#chunks, { type: recorder.mimeType }));
    const result = await window.openbot.voice.transcribe({ audio });
    const text = result.text.trim();
    if (!text) throw new GlobalVoiceDictationError("noSpeech", "");
    return text;
  }

  /** Stops the microphone and drops the recording. Nothing is transcribed. */
  cancel(): void {
    this.#clearTimers();
    const recorder = this.#recorder;
    this.#recorder = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.#release();
    this.#chunks = [];
  }

  get active(): boolean {
    return this.#recorder !== null;
  }

  async #refreshLive(): Promise<void> {
    const recorder = this.#recorder;
    if (!recorder || this.#chunks.length === 0) return;
    try {
      const audio = await recordingToWav(new Blob(this.#chunks, { type: recorder.mimeType }));
      const result = await window.openbot.voice.transcribe({ audio });
      if (this.#recorder === recorder) this.#onLive(result.text.trim());
    } catch {
      // The live text is a preview: the final pass reports any failure.
    }
  }

  #clearTimers(): void {
    if (this.#limitTimer !== undefined) clearTimeout(this.#limitTimer);
    if (this.#liveTimer !== undefined) clearInterval(this.#liveTimer);
    this.#limitTimer = undefined;
    this.#liveTimer = undefined;
  }

  #release(): void {
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
  }
}
