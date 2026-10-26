import {
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  DYNAMIC_ISLAND_SIZE_LIMITS,
  type DynamicIslandPreference,
  isDynamicIslandServerVisibility,
  isDynamicIslandSizePercent,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The island always ran on macOS, so it stays on there by default. On Windows and Linux it is new
 * and draws an always-on-top window, so it stays off until the user turns it on in Settings. The
 * file records that choice as `offMacOptIn`; a file written by a macOS-only build (or none at all)
 * never turns the island on by itself on another platform.
 */
export function defaultDynamicIslandPreference(platform: NodeJS.Platform = "darwin"): DynamicIslandPreference {
  return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE, enabled: platform === "darwin" };
}

export const readDynamicIslandPreference = Effect.fn("readDynamicIslandPreference")(
  (path: string, platform: NodeJS.Platform = "darwin") =>
    readDynamicIslandPreferenceFields(path).pipe(
      Effect.map((preference) => {
        if (platform === "darwin") return preference.preference;
        return { ...preference.preference, enabled: preference.preference.enabled && preference.offMacOptIn };
      }),
    ),
);

const readDynamicIslandPreferenceFields = (path: string) =>
  readPreferenceFile(path, (parsed): { preference: DynamicIslandPreference; offMacOptIn: boolean } => ({
    preference: parseDynamicIslandPreference(parsed),
    offMacOptIn: isDynamicRecord(parsed) && parsed.offMacOptIn === true,
  })).pipe(
    Effect.catch((failure) => {
      const error = failure.cause;
      if (isMissingFileError(error) || error instanceof SyntaxError)
        return Effect.succeed({ preference: { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE }, offMacOptIn: false });
      return Effect.fail(failure);
    }),
  );

function parseDynamicIslandPreference(parsed: unknown): DynamicIslandPreference {
  if (!isDynamicRecord(parsed) || !isBoolean(parsed.enabled)) {
    return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
  }
  if (parsed.version === 1) return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE, enabled: parsed.enabled };
  if (parsed.version === 2 && isBoolean(parsed.hapticsEnabled)) {
    return {
      ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
      enabled: parsed.enabled,
      hapticsEnabled: parsed.hapticsEnabled,
    };
  }
  if (
    parsed.version !== 3 ||
    !isBoolean(parsed.hapticsEnabled) ||
    !isBoolean(parsed.idleVisible) ||
    !isBoolean(parsed.additionalDisplaysEnabled)
  ) {
    return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
  }
  return {
    enabled: parsed.enabled,
    hapticsEnabled: parsed.hapticsEnabled,
    idleVisible: parsed.idleVisible,
    additionalDisplaysEnabled: parsed.additionalDisplaysEnabled,
    // The size is optional so that 0.18.0 and earlier, which refuse any version but 3, still read
    // this file. A missing or out-of-range size resets only the size, so a bad value cannot make
    // the island too small to find and does not discard the switches beside it.
    widthPercent: isDynamicIslandSizePercent(parsed.widthPercent, DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent)
      ? parsed.widthPercent
      : DEFAULT_DYNAMIC_ISLAND_PREFERENCE.widthPercent,
    heightPercent: isDynamicIslandSizePercent(parsed.heightPercent, DYNAMIC_ISLAND_SIZE_LIMITS.heightPercent)
      ? parsed.heightPercent
      : DEFAULT_DYNAMIC_ISLAND_PREFERENCE.heightPercent,
    // The server choices are optional for the same reason. A bad value resets only the choices,
    // which shows every server again, as the island did before the choices existed.
    ...(isDynamicIslandServerVisibility(parsed.serverVisibility) && isBoolean(parsed.newServersVisible)
      ? { serverVisibility: { ...parsed.serverVisibility }, newServersVisible: parsed.newServersVisible }
      : { serverVisibility: {}, newServersVisible: DEFAULT_DYNAMIC_ISLAND_PREFERENCE.newServersVisible }),
  };
}

export function writeDynamicIslandPreference(
  path: string,
  preference: DynamicIslandPreference,
  platform: NodeJS.Platform = "darwin",
): Effect.Effect<DynamicIslandPreference, PreferenceFileFailure> {
  return Effect.gen(function* () {
    yield* writePreferenceFile(path, {
      version: 3,
      ...preference,
      ...(platform === "darwin" ? {} : { offMacOptIn: preference.enabled }),
    });
    return { ...preference };
  });
}
