import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { fallbackFor, VoicePreferenceStore } from "./voice-preference-store";

const file = () => join(mkdtempSync(join(tmpdir(), "voice-pref-")), "voice-preference.json");

describe("VoicePreferenceStore", () => {
  it("defaults to Whisper with automatic language and an Arabic hint", async () => {
    const store = new VoicePreferenceStore(file());
    await Effect.runPromise(store.load());
    expect(store.get()).toEqual({ modelId: "whisper-turbo", language: "automatic", fallbackLanguage: "ar" });
  });

  it("keeps a saved fixed language, which is also the hint", async () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ version: 1, modelId: "whisper-turbo", language: "en" }));
    const store = new VoicePreferenceStore(path);
    await Effect.runPromise(store.load());
    expect(store.get()).toEqual({ modelId: "whisper-turbo", language: "en", fallbackLanguage: "en" });
  });

  it("remembers the last fixed language as the hint after switching to automatic", async () => {
    const path = file();
    const store = new VoicePreferenceStore(path);
    await Effect.runPromise(store.load());
    await Effect.runPromise(store.set({ modelId: "whisper-turbo", language: "en" }));
    await Effect.runPromise(store.set({ modelId: "whisper-turbo", language: "automatic" }));
    expect(store.get().fallbackLanguage).toBe("en");
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ language: "automatic", fallbackLanguage: "en" });
  });
});

describe("fallbackFor", () => {
  it("ignores an unknown saved hint", () => {
    expect(fallbackFor("automatic", "fr")).toBe("ar");
  });
});
