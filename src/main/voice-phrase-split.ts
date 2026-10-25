// Splits dictation audio at pauses, so that Whisper can find the language of each phrase.
//
// Whisper picks one language for all the audio it reads. A speaker who switches between Arabic and
// English (common in Egyptian Arabic) loses the phrases in the other language, so with automatic
// language each phrase between pauses is decoded on its own.
//
// Pure and import-free: the transcription host may import nothing but node:* builtins at runtime.

/** 20 ms frames at 16 kHz. */
const FRAME_SAMPLES = 320;
/** A pause at least this long ends a phrase. */
const MINIMUM_PAUSE_FRAMES = 15; // 300 ms
/** Whisper detects a language poorly in very short audio, so shorter phrases join a neighbour. */
const MINIMUM_PHRASE_SAMPLES = 16_000; // 1 s
/** A frame is quiet below this share of the loud level of the recording. */
const QUIET_SHARE = 0.08;
/** A frame is always quiet below this level, so a silent recording stays one part. */
const QUIET_FLOOR = 0.003;

function frameLevels(samples: Float32Array): number[] {
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += FRAME_SAMPLES) {
    const end = Math.min(samples.length, start + FRAME_SAMPLES);
    let energy = 0;
    for (let index = start; index < end; index += 1) energy += (samples[index] ?? 0) ** 2;
    levels.push(Math.sqrt(energy / Math.max(1, end - start)));
  }
  return levels;
}

/** Returns the phrases of the audio in order. Together they cover every sample once. */
export function splitAtPauses(samples: Float32Array): Float32Array[] {
  const levels = frameLevels(samples);
  if (levels.length === 0) return [samples];
  const sorted = [...levels].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const quiet = Math.max(QUIET_FLOOR, loud * QUIET_SHARE);

  // Cut in the middle of each long enough run of quiet frames that has speech on both sides.
  const cuts: number[] = [];
  let runStart = -1;
  let heardSpeech = false;
  for (let frame = 0; frame <= levels.length; frame += 1) {
    const isQuiet = frame < levels.length && (levels[frame] ?? 0) < quiet;
    if (isQuiet) {
      if (runStart < 0) runStart = frame;
      continue;
    }
    if (runStart >= 0 && heardSpeech && frame < levels.length && frame - runStart >= MINIMUM_PAUSE_FRAMES) {
      cuts.push(Math.floor((runStart + frame) / 2) * FRAME_SAMPLES);
    }
    runStart = -1;
    if (frame < levels.length) heardSpeech = true;
  }

  const bounds = [0, ...cuts, samples.length];
  const phrases: Array<[number, number]> = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    const start = bounds[index] ?? 0;
    const end = bounds[index + 1] ?? samples.length;
    const last = phrases.at(-1);
    if (last && (last[1] - last[0] < MINIMUM_PHRASE_SAMPLES || end - start < MINIMUM_PHRASE_SAMPLES)) last[1] = end;
    else phrases.push([start, end]);
  }
  return phrases.map(([start, end]) => samples.subarray(start, end));
}

/** Reads the language code from the `lang` field of a sherpa-onnx result, like `<|ar|>` or `ar`. */
export function detectedLanguage(result: unknown): string {
  if (typeof result !== "object" || result === null || !("lang" in result) || typeof result.lang !== "string")
    return "";
  return result.lang.replace(/^<\|/, "").replace(/\|>$/, "").trim().toLowerCase();
}
