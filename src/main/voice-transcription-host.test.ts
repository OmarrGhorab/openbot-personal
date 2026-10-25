import { describe, expect, it } from "vitest";
import { type LoadedRecognizer, transcribeAutomatic } from "./voice-transcription-host";

const RATE = 16_000;

/** What the fake Whisper answers for a phrase, by its loudness. */
interface Phrase {
  level: number;
  auto: { text: string; lang: string };
  ar?: string;
  en?: string;
}

function audio(phrases: Phrase[]): Float32Array {
  const pieces: number[] = [];
  for (const phrase of phrases) {
    for (let index = 0; index < 1.5 * RATE; index += 1) pieces.push(phrase.level * Math.sin(index / 7));
    for (let index = 0; index < 0.5 * RATE; index += 1) pieces.push(0);
  }
  return Float32Array.from(pieces);
}

function fakeWhisper(phrases: Phrase[]): LoadedRecognizer & { decodes: string[] } {
  let language = "";
  const decodes: string[] = [];
  let wave: Float32Array = new Float32Array(0);
  return {
    decodes,
    key: "fake",
    recognizer: {},
    engine: "whisper",
    modelDirectory: "/models",
    language: "",
    addon: {
      createOfflineRecognizerAsync: async () => ({}),
      createOfflineStream: () => ({}),
      acceptWaveformOffline: (_stream, input) => {
        wave = input.samples;
      },
      decodeOfflineStreamAsync: async () => undefined,
      getOfflineStreamResultAsJson: () => {
        const peak = wave.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        const phrase = phrases.reduce((best, item) =>
          Math.abs(item.level - peak) < Math.abs(best.level - peak) ? item : best,
        );
        decodes.push(language || "auto");
        if (!language) return JSON.stringify({ text: phrase.auto.text, lang: `<|${phrase.auto.lang}|>` });
        return JSON.stringify({ text: (language === "ar" ? phrase.ar : phrase.en) ?? "", lang: `<|${language}|>` });
      },
      offlineRecognizerSetConfig: (_recognizer, config) => {
        language = config.modelConfig.whisper?.language ?? "";
      },
    },
  };
}

describe("transcribeAutomatic", () => {
  it("keeps Arabic and English phrases each in their own language", async () => {
    const phrases: Phrase[] = [
      { level: 0.2, auto: { text: "افتح الإعدادات", lang: "ar" } },
      { level: 0.4, auto: { text: "Check the build", lang: "en" }, ar: "تشيك ذا بيلد" },
      { level: 0.6, auto: { text: "وقولي", lang: "ar" } },
    ];
    const texts = await transcribeAutomatic(fakeWhisper(phrases), audio(phrases), "ar");
    expect(texts).toEqual(["افتح الإعدادات", "Check the build", "وقولي"]);
  });

  it("keeps a mixed phrase in Arabic mode instead of translating it", async () => {
    const phrases: Phrase[] = [
      { level: 0.2, auto: { text: "لو سمحت شوف", lang: "ar" } },
      { level: 0.5, auto: { text: "and tell me if tests passed", lang: "en" }, ar: "وقولي ال tests passed" },
    ];
    const texts = await transcribeAutomatic(fakeWhisper(phrases), audio(phrases), "ar");
    expect(texts).toEqual(["لو سمحت شوف", "وقولي ال tests passed"]);
  });

  it("does not decode English again when nothing was Arabic", async () => {
    const phrases: Phrase[] = [
      { level: 0.2, auto: { text: "Open settings.", lang: "en" } },
      { level: 0.5, auto: { text: "Check the build.", lang: "en" } },
    ];
    const whisper = fakeWhisper(phrases);
    expect(await transcribeAutomatic(whisper, audio(phrases), "ar")).toEqual(["Open settings.", "Check the build."]);
    expect(whisper.decodes).toEqual(["auto", "auto"]);
  });

  it("decodes a phrase detected as a third language in the fallback language", async () => {
    const phrases: Phrase[] = [{ level: 0.3, auto: { text: "Ман хоҳам", lang: "fa" }, en: "I want" }];
    const whisper = fakeWhisper(phrases);
    expect(await transcribeAutomatic(whisper, audio(phrases), "en")).toEqual(["I want"]);
    expect(whisper.language).toBe("");
  });
});
