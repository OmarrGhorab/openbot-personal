import { VOICE_AUDIO_LIMITS, VOICE_MODELS, VOICE_STREAM_LIMITS } from "@openbot/contracts/ipc";
import { encodePcm16, recordingToSamples, recordingToWav } from "../../voice-recording";

/** How often the recording so far is transcribed again for the live text of a local model. */
const LIVE_INTERVAL_MS = 500;
/** How often a streamed recording sends its new audio to the cloud model. */
const STREAM_INTERVAL_MS = 250;
/** A dropped cloud stream is opened again, with the whole utterance replayed, this many times. */
const STREAM_RETRY_LIMIT = 2;
/** A local final pass is tried again once: the speech host can end between passes. */
const FINAL_RETRY_LIMIT = 2;

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

/** One streamed dictation in main. The renderer keeps the audio that main has already received. */
interface CloudDictation {
  streamId: string;
  /** How many 16 kHz samples main has received. */
  sentSamples: number;
  /** Stops the transcript events of this stream. */
  stopTranscript: () => void;
}

/**
 * One dictation in the window: the microphone, the live text while the user speaks, and the final
 * text after Stop. The model and the language are the saved voice settings, read by main, so
 * Arabic and English work as they do in the chat.
 *
 * A local model transcribes the recording so far every 500 ms. The cloud model streams the new
 * audio as it is recorded, so its words appear while the user speaks. A dropped stream is replaced
 * and the whole utterance is replayed, so a network drop does not lose the text.
 */
export class GlobalVoiceDictation {
  #recorder: MediaRecorder | null = null;
  #stream: MediaStream | null = null;
  #chunks: Blob[] = [];
  #mimeType = "";
  #meter: { context: AudioContext; timer: ReturnType<typeof setInterval> } | null = null;
  /** The loudest sound so far above the noise floor, in dB. Speech reaches `SPEECH_ABOVE_NOISE_DB`. */
  #loudestAboveNoiseDb = 0;
  #limitTimer: ReturnType<typeof setTimeout> | undefined;
  #liveTimer: ReturnType<typeof setInterval> | undefined;
  #liveRequest: Promise<void> = Promise.resolve();
  #cloud: CloudDictation | null = null;
  /** True for a model that streams to a provider instead of transcribing the recording here. */
  #cloudModel = false;
  /** How many times a dropped stream has been replaced while the user speaks. */
  #cloudRetries = 0;
  #streamRequest: Promise<void> = Promise.resolve();
  #streamQueued = false;
  #lastLiveText = "";
  #startedAt = 0;
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
    this.#cloudModel = false;
    this.#lastLiveText = "";
    const [status, settings] = await Promise.all([
      window.openbot.voice.prepareModel(),
      window.openbot.voice.getSettings(),
    ]);
    if (session !== this.#session) throw new GlobalVoiceDictationError("failed", "");
    const model = VOICE_MODELS.find((candidate) => candidate.id === settings.modelId);
    // Whisper reads the whole clip each time: a preview every second queues passes that each take
    // as long as the clip, and Stop waits for all of them. Only fast models preview.
    const livePreview = model?.livePreview ?? true;
    this.#cloudModel = model?.kind === "cloud";
    if (status.phase !== "ready") {
      throw new GlobalVoiceDictationError("unavailable", status.message ?? "");
    }
    // Load the local model while the user speaks, not when the first text is needed. A cloud model
    // has nothing to load, and this answers at once.
    await window.openbot.voice.warmModel().catch(() => undefined);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (session !== this.#session) {
      for (const track of stream.getTracks()) track.stop();
      throw new GlobalVoiceDictationError("failed", "");
    }
    if (this.#cloudModel) {
      // The stream opens after the microphone so it does not sit idle behind a permission prompt.
      try {
        await this.#openCloud();
      } catch (error) {
        for (const track of stream.getTracks()) track.stop();
        throw error;
      }
      if (session !== this.#session) {
        this.#discardCloud();
        for (const track of stream.getTracks()) track.stop();
        throw new GlobalVoiceDictationError("failed", "");
      }
    }
    try {
      const recorder = new MediaRecorder(stream);
      this.#stream = stream;
      this.#recorder = recorder;
      this.#chunks = [];
      this.#mimeType = recorder.mimeType;
      this.#lastLiveText = "";
      this.#cloudRetries = 0;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) this.#chunks.push(event.data);
        // Only a cloud recording streams while the user speaks; its last chunk is sent by Stop.
        if (this.#cloudModel && this.#recorder === recorder) this.#queueStreamAudio();
      });
      this.#startMeter(stream);
      recorder.start(STREAM_INTERVAL_MS);
      this.#startedAt = performance.now();
      performance.clearMarks("voice-dictation-start");
      performance.clearMarks("voice-dictation-stop");
      performance.clearMeasures("voice-dictation-final");
      performance.clearMeasures("voice-dictation-total");
      performance.mark("voice-dictation-start");
      this.#limitTimer = setTimeout(() => this.#onLimit(), VOICE_AUDIO_LIMITS.maximumSeconds * 1_000);
      if (!this.#cloudModel && livePreview) {
        this.#liveTimer = setInterval(() => {
          this.#liveRequest = this.#liveRequest.then(() => this.#refreshLive());
        }, LIVE_INTERVAL_MS);
      }
    } catch (error) {
      this.#discardCloud();
      for (const track of stream.getTracks()) track.stop();
      throw error;
    }
  }

  /** Stops the microphone and returns the text. Throws when no speech was heard. */
  async stop(): Promise<string> {
    const recorder = this.#recorder;
    if (!recorder) throw new GlobalVoiceDictationError("failed", "");
    // No live text arrives after Stop: the final text replaces it.
    this.#recorder = null;
    this.#clearTimers();
    performance.mark("voice-dictation-stop");
    if (recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.#release();
    try {
      // The live pass and the final pass cannot run at once: main takes one transcription at a time.
      await this.#liveRequest;
      if (this.#chunks.length === 0) throw new GlobalVoiceDictationError("noSpeech", "");
      // A recording that never rose above the room holds no speech; Whisper would invent a line.
      if (this.#metered && this.#loudestAboveNoiseDb < SPEECH_ABOVE_NOISE_DB)
        throw new GlobalVoiceDictationError("noSpeech", "");
      const text = this.#cloudModel ? await this.#finishCloud() : await this.#transcribeLocal();
      const cleaned = withoutWhisperFiller(text);
      if (!cleaned) throw new GlobalVoiceDictationError("noSpeech", "");
      return cleaned;
    } catch (error) {
      // A stream that will not finish still has no reason to stay open.
      if (this.#cloudModel) this.#discardCloud();
      throw error;
    } finally {
      // A start that never reached its marks has nothing to measure.
      if (
        performance.getEntriesByName("voice-dictation-start", "mark").length > 0 &&
        performance.getEntriesByName("voice-dictation-stop", "mark").length > 0
      ) {
        performance.measure("voice-dictation-final", "voice-dictation-stop");
        performance.measure("voice-dictation-total", "voice-dictation-start");
      }
      this.#startedAt = 0;
    }
  }

  /** Stops the microphone and drops the recording. Nothing is transcribed. */
  cancel(): void {
    this.#session += 1;
    this.#clearTimers();
    const recorder = this.#recorder;
    this.#recorder = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.#discardCloud();
    this.#release();
    this.#chunks = [];
    this.#lastLiveText = "";
    this.#cloudModel = false;
    this.#startedAt = 0;
  }

  get active(): boolean {
    return this.#recorder !== null;
  }

  /** How long the recording has run, for the analytics of one dictation. */
  get elapsedSeconds(): number {
    return this.#startedAt === 0 ? 0 : Math.max(0, (performance.now() - this.#startedAt) / 1_000);
  }

  /** The recording so far, as the browser encoded it. */
  #recording(): Blob {
    return new Blob(this.#chunks, { type: this.#mimeType });
  }

  async #transcribeLocal(): Promise<string> {
    const audio = await recordingToWav(this.#recording());
    let lastError: unknown;
    for (let attempt = 0; attempt < FINAL_RETRY_LIMIT; attempt += 1) {
      try {
        const result = await window.openbot.voice.transcribe({ audio });
        return result.text;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new GlobalVoiceDictationError("failed", "");
  }

  /** Opens a stream and registers its live text. The stream is cancelled if it cannot open. */
  async #openCloud(): Promise<CloudDictation> {
    const { streamId } = await window.openbot.voice.startStream();
    const stopTranscript = window.openbot.voice.onStreamTranscript((event) => {
      if (event.streamId !== streamId) return;
      const text = withoutWhisperFiller(event.text);
      this.#lastLiveText = text;
      this.#onLive(text);
    });
    const cloud = { streamId, sentSamples: 0, stopTranscript };
    this.#cloud = cloud;
    return cloud;
  }

  /** Sends the audio that main does not have yet. Each pass decodes the whole recording again. */
  async #sendNewAudio(): Promise<void> {
    if (!this.#cloudModel) return;
    if (!this.#cloud) {
      await this.#reconnectCloud();
      if (!this.#cloud) return;
    }
    const cloud = this.#cloud;
    if (!cloud || this.#chunks.length === 0) return;
    let samples: Float32Array;
    try {
      samples = await recordingToSamples(this.#recording());
    } catch {
      // The next pass, or the final one, decodes the recording again.
      return;
    }
    if (samples.length <= cloud.sentSamples || this.#cloud !== cloud) return;
    try {
      await this.#appendAudio(cloud.streamId, encodePcm16(samples.subarray(cloud.sentSamples)));
      cloud.sentSamples = samples.length;
    } catch {
      if (this.#cloud === cloud) await this.#reconnectCloud();
    }
  }

  #queueStreamAudio(): void {
    // A pass that arrives while one runs would send the same samples twice; the next chunk covers it.
    if (this.#streamQueued) return;
    this.#streamQueued = true;
    this.#streamRequest = this.#streamRequest
      .then(() => this.#sendNewAudio())
      .catch(() => undefined)
      .finally(() => {
        this.#streamQueued = false;
      });
  }

  async #appendAudio(streamId: string, pcm: Uint8Array): Promise<void> {
    // A copy for each part, because IPC would copy the whole buffer of a view.
    for (let offset = 0; offset < pcm.byteLength; offset += VOICE_STREAM_LIMITS.maximumChunkBytes)
      await window.openbot.voice.appendStream({
        streamId,
        pcm: pcm.slice(offset, offset + VOICE_STREAM_LIMITS.maximumChunkBytes),
      });
  }

  /** Replaces a dropped stream while the user speaks, and replays the utterance into it. */
  async #reconnectCloud(): Promise<void> {
    if (this.#cloudRetries >= STREAM_RETRY_LIMIT) {
      this.#discardCloud();
      return;
    }
    this.#cloudRetries += 1;
    await this.#openAndReplayCloud();
  }

  /** Opens a new stream and sends the whole utterance from its first sample. */
  async #openAndReplayCloud(): Promise<boolean> {
    this.#discardCloud();
    try {
      const cloud = await this.#openCloud();
      if (this.#chunks.length > 0) {
        const samples = await recordingToSamples(this.#recording());
        await this.#appendAudio(cloud.streamId, encodePcm16(samples));
        cloud.sentSamples = samples.length;
      }
      return true;
    } catch {
      this.#discardCloud();
      return false;
    }
  }

  /** Ends the stream in main. Its text is dropped, because the caller is not using it. */
  #discardCloud(): void {
    const cloud = this.#cloud;
    this.#cloud = null;
    if (!cloud) return;
    cloud.stopTranscript();
    void window.openbot.voice.cancelStream({ streamId: cloud.streamId }).catch(() => undefined);
  }

  /**
   * Sends the last audio and ends the stream. A stream that fails is replaced and the whole
   * utterance is replayed, so a drop near the end does not lose the text. If every attempt fails,
   * the live text stands for the utterance instead of an error that throws it away.
   */
  async #finishCloud(): Promise<string> {
    await this.#streamRequest;
    // The last chunk arrives with Stop, after the pass that was running.
    if (this.#cloud) await this.#sendNewAudio();
    let lastError: unknown;
    for (let attempt = 0; attempt <= STREAM_RETRY_LIMIT; attempt += 1) {
      if (!this.#cloud && !(await this.#openAndReplayCloud())) continue;
      const cloud = this.#cloud;
      if (!cloud) continue;
      try {
        const result = await window.openbot.voice.finishStream({ streamId: cloud.streamId });
        this.#cloud = null;
        cloud.stopTranscript();
        return result.text;
      } catch (error) {
        lastError = error;
        this.#discardCloud();
      }
    }
    if (this.#lastLiveText.trim()) return this.#lastLiveText;
    throw lastError ?? new GlobalVoiceDictationError("failed", "");
  }

  async #refreshLive(): Promise<void> {
    const recorder = this.#recorder;
    if (!recorder || this.#chunks.length === 0) return;
    try {
      const audio = await recordingToWav(this.#recording());
      const result = await window.openbot.voice.transcribe({ audio });
      if (this.#recorder === recorder) {
        const text = withoutWhisperFiller(result.text);
        this.#lastLiveText = text;
        this.#onLive(text);
      }
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
