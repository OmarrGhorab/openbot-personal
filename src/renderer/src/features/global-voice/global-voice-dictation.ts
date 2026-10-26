import { VOICE_AUDIO_LIMITS, VOICE_MODELS } from "@openbot/contracts/ipc";
import { recordingToWav } from "../../voice-recording";

/** How often the recording so far is transcribed again for the live text. */
const LIVE_INTERVAL_MS = 1_500;

/** How often the microphone level is read, and the levels that count as speech. */
const LEVEL_INTERVAL_MS = 50;
/** A muted input or a stream that has not started yet reads at this level; no real room does. */
const DIGITAL_SILENCE_DB = -90;
/** The noise floor follows the quietest recent sound; it falls at once and rises slowly. */
const NOISE_RISE_DB = 0.1;
/** Speech is at least this much louder than the room. Below it, Whisper writes subtitle credits. */
const SPEECH_ABOVE_NOISE_DB = 12;

/**
 * Lines that Whisper writes for silence or noise: the credits and calls to action of the video
 * subtitles it learned from. They are never what the user said, so they are removed.
 */
const WHISPER_FILLER_LINES = [
  /ترجمة\s*نانسي\s*قنقر/gu,
  /اشتركوا?\s*في\s*(ال)?قناة/gu,
  /لا\s*تنسوا?\s*الاشتراك/gu,
  /شكرا\s*(لكم\s*)?(على|علي)\s*المشاهدة/gu,
  /(thanks|thank you) for watching[.!]?/giu,
  /subtitles? by[^.\n]*/giu,
  /amara\.org[^.\n]*/giu,
  /please subscribe[^.\n]*/giu,
];

/** The text without Whisper filler lines. A text that was only filler becomes empty. */
export function withoutWhisperFiller(text: string): string {
  let cleaned = text;
  let filler = false;
  for (const line of WHISPER_FILLER_LINES) {
    const next = cleaned.replace(line, " ");
    if (next !== cleaned) filler = true;
    cleaned = next;
  }
  // Filler on silence often comes with a repeated "thanks" and stray punctuation.
  cleaned = cleaned.replace(/^(\s*(شكرا|شكراً|thanks|thank you)[\s.,!،؟?]*)+$/giu, "");
  cleaned = cleaned
    .replace(/\s+/gu, " ")
    .replace(/^[\s.,!،؟?]+|[\s,،]+$/gu, "")
    .trim();
  // Filler with a few stray words around it is still noise, not a task.
  if (filler && cleaned.split(" ").filter(Boolean).length <= 3) return "";
  return cleaned;
}

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
  #meter: { context: AudioContext; timer: ReturnType<typeof setInterval> } | null = null;
  /** The loudest sound so far above the noise floor, in dB. Speech reaches `SPEECH_ABOVE_NOISE_DB`. */
  #loudestAboveNoiseDb = 0;
  #limitTimer: ReturnType<typeof setTimeout> | undefined;
  #liveTimer: ReturnType<typeof setInterval> | undefined;
  #liveRequest: Promise<void> = Promise.resolve();
  #onLimit: () => void = () => {};
  #onLive: (text: string) => void = () => {};
  #onLevel: (level: number) => void = () => {};
  /** Changes on each start and cancel, so a start that resolves after either one opens nothing. */
  #session = 0;

  /** Opens the microphone and starts recording. `onLimit` runs when the time limit is reached. */
  async start(callbacks: {
    onLive: (text: string) => void;
    onLimit: () => void;
    onLevel?: (level: number) => void;
  }): Promise<void> {
    const session = ++this.#session;
    this.#onLive = callbacks.onLive;
    this.#onLimit = callbacks.onLimit;
    this.#onLevel = callbacks.onLevel ?? (() => {});
    const [status, settings] = await Promise.all([
      window.openbot.voice.prepareModel(),
      window.openbot.voice.getSettings(),
    ]);
    // Whisper reads the whole clip each time: a preview every 1.5 s queues passes that each take
    // as long as the clip, and Stop waits for all of them. Only fast models preview.
    const livePreview = VOICE_MODELS.find((model) => model.id === settings.modelId)?.livePreview ?? true;
    if (status.phase !== "ready") {
      throw new GlobalVoiceDictationError("unavailable", status.message ?? "");
    }
    if (session !== this.#session) throw new GlobalVoiceDictationError("failed", "");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // The window gave up on this start while the microphone was opening: release it and stop.
    if (session !== this.#session) {
      for (const track of stream.getTracks()) track.stop();
      throw new GlobalVoiceDictationError("failed", "");
    }
    const recorder = new MediaRecorder(stream);
    this.#stream = stream;
    this.#recorder = recorder;
    this.#chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    });
    this.#startMeter(stream);
    recorder.start(1_000);
    this.#limitTimer = setTimeout(() => this.#onLimit(), VOICE_AUDIO_LIMITS.maximumSeconds * 1_000);
    if (livePreview) {
      this.#liveTimer = setInterval(() => {
        this.#liveRequest = this.#liveRequest.then(() => this.#refreshLive());
      }, LIVE_INTERVAL_MS);
    }
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
    // A recording that never rose above the room holds no speech; Whisper would invent a line.
    if (this.#metered && this.#loudestAboveNoiseDb < SPEECH_ABOVE_NOISE_DB)
      throw new GlobalVoiceDictationError("noSpeech", "");
    const audio = await recordingToWav(new Blob(this.#chunks, { type: recorder.mimeType }));
    const result = await window.openbot.voice.transcribe({ audio });
    const text = withoutWhisperFiller(result.text);
    if (!text) throw new GlobalVoiceDictationError("noSpeech", "");
    return text;
  }

  /** Stops the microphone and drops the recording. Nothing is transcribed. */
  cancel(): void {
    this.#session += 1;
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
      if (this.#recorder === recorder) this.#onLive(withoutWhisperFiller(result.text));
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
    this.#stopMeter();
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
  }

  /** True when the level was measured; without an AudioContext the silence check is skipped. */
  #metered = false;

  #startMeter(stream: MediaStream): void {
    this.#loudestAboveNoiseDb = 0;
    this.#metered = false;
    let context: AudioContext | undefined;
    let analyser: AnalyserNode;
    try {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
    } catch {
      void context?.close();
      return;
    }
    this.#metered = true;
    const samples = new Float32Array(analyser.fftSize);
    let noiseDb = Number.POSITIVE_INFINITY;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const db = 20 * Math.log10(Math.max(Math.sqrt(sum / samples.length), 1e-5));
      if (db <= DIGITAL_SILENCE_DB) {
        this.#onLevel(0);
        return;
      }
      noiseDb = db < noiseDb ? db : Math.min(db, noiseDb + NOISE_RISE_DB);
      const above = db - noiseDb;
      this.#loudestAboveNoiseDb = Math.max(this.#loudestAboveNoiseDb, above);
      this.#onLevel(Math.max(0, Math.min(1, above / 24)));
    }, LEVEL_INTERVAL_MS);
    this.#meter = { context, timer };
  }

  #stopMeter(): void {
    const meter = this.#meter;
    this.#meter = null;
    if (!meter) return;
    clearInterval(meter.timer);
    void meter.context.close();
  }
}
