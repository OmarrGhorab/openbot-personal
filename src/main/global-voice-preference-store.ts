import {
  DEFAULT_GLOBAL_VOICE_PREFERENCE,
  type GlobalVoicePreference,
  toGlobalVoicePreference,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/** A missing, unreadable or unknown file reads as the defaults, as the Dynamic Island preference does. */
export const readGlobalVoicePreference = Effect.fn("readGlobalVoicePreference")((path: string) =>
  readPreferenceFile(path, (parsed): GlobalVoicePreference => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1) return structuredClone(DEFAULT_GLOBAL_VOICE_PREFERENCE);
    return toGlobalVoicePreference(parsed) ?? structuredClone(DEFAULT_GLOBAL_VOICE_PREFERENCE);
  }).pipe(
    Effect.catch((failure) => {
      const error = failure.cause;
      if (isMissingFileError(error) || error instanceof SyntaxError) {
        return Effect.succeed(structuredClone(DEFAULT_GLOBAL_VOICE_PREFERENCE));
      }
      return Effect.fail(failure);
    }),
  ),
);

export function writeGlobalVoicePreference(
  path: string,
  preference: GlobalVoicePreference,
): Effect.Effect<GlobalVoicePreference, PreferenceFileFailure> {
  return Effect.gen(function* () {
    const saved = structuredClone(preference);
    yield* writePreferenceFile(path, { version: 1, ...saved });
    return saved;
  });
}
