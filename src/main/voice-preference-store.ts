import {
  AUTOMATIC_VOICE_LANGUAGE,
  DEFAULT_VOICE_SETTINGS,
  isVoiceLanguage,
  isVoiceModelId,
  type VoiceSettings,
  type WhisperLanguage,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The dictation model and language. Transcription reads it about once per second while the user
 * speaks, so it is held in memory after `load`.
 *
 * A file that is missing, unreadable as JSON or names an unknown model or language reads as
 * the default: Whisper with automatic language. A saved fixed language stays fixed, and is also
 * the fallback hint for automatic detection.
 */
export class VoicePreferenceStore {
  readonly #path: string;
  #settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): VoiceSettings | null =>
          isDynamicRecord(parsed) &&
          parsed.version === 1 &&
          isVoiceModelId(parsed.modelId) &&
          isVoiceLanguage(parsed.language)
            ? {
                modelId: parsed.modelId,
                language: parsed.language,
                fallbackLanguage: fallbackFor(parsed.language, parsed.fallbackLanguage),
              }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#settings = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): VoiceSettings {
    return { ...this.#settings };
  }

  readonly set = Effect.fn("VoicePreference.set")(function* (
    this: VoicePreferenceStore,
    { modelId, language, fallbackLanguage }: VoiceSettings,
  ) {
    const settings: VoiceSettings = {
      modelId,
      language,
      fallbackLanguage: fallbackFor(language, fallbackLanguage ?? this.#settings.fallbackLanguage),
    };
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, ...settings }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#settings = settings;
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}

/** A fixed language is its own fallback; automatic keeps a saved Arabic or English hint, else Arabic. */
export function fallbackFor(language: VoiceSettings["language"], saved: unknown): WhisperLanguage {
  if (language !== AUTOMATIC_VOICE_LANGUAGE) return language;
  return saved === "ar" || saved === "en" ? saved : "ar";
}
