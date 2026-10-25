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
  it("reads an Arabic clip once", async () => {
    const phrases: Phrase[] = [{ level: 0.3, auto: { text: "افتح الإعدادات وقولي", lang: "ar" } }];
    const whisper = fakeWhisper(phrases);
    expect(await transcribeAutomatic(whisper, audio(phrases), "ar")).toEqual(["افتح الإعدادات وقولي"]);
    expect(whisper.decodes).toEqual(["auto"]);
  });

  it("keeps mixed speech detected as English in Arabic instead of translating it", async () => {
    const phrases: Phrase[] = [
      { level: 0.5, auto: { text: "and tell me if tests passed", lang: "en" }, ar: "وقولي ال tests passed" },
    ];
    const whisper = fakeWhisper(phrases);
    expect(await transcribeAutomatic(whisper, audio(phrases), "ar")).toEqual(["وقولي ال tests passed"]);
    expect(whisper.decodes).toEqual(["auto", "ar"]);
  });

  it("keeps English when the Arabic reading has no English words", async () => {
    const phrases: Phrase[] = [{ level: 0.5, auto: { text: "Check the build.", lang: "en" }, ar: "تشيك ذا بيلد" }];
    expect(await transcribeAutomatic(fakeWhisper(phrases), audio(phrases), "ar")).toEqual(["Check the build."]);
  });

  it("decodes a phrase detected as a third language in the fallback language", async () => {
    const phrases: Phrase[] = [{ level: 0.3, auto: { text: "Ман хоҳам", lang: "fa" }, en: "I want" }];
    const whisper = fakeWhisper(phrases);
    expect(await transcribeAutomatic(whisper, audio(phrases), "en")).toEqual(["I want"]);
    expect(whisper.language).toBe("");
  });
});
