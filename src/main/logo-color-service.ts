import {
  type AppLogoColorPreference,
  DEFAULT_APP_LOGO_COLOR,
  DEFAULT_APP_LOGO_SHAPE,
  DEFAULT_APP_LOGO_TILE,
  isAppLogoColor,
  isAppLogoShape,
  isAppLogoTile,
  type SetAppLogoColorPreferenceInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const DEFAULT_PREFERENCE: AppLogoColorPreference = {
  color: DEFAULT_APP_LOGO_COLOR,
  shape: DEFAULT_APP_LOGO_SHAPE,
  tile: DEFAULT_APP_LOGO_TILE,
};

/**
 * The saved logo preference, or the default. A file that is missing, unreadable or names a value this
 * build does not ship reads as the default for that value: a lost choice must not stop the app from
 * starting. The file stays at version 1. `shape` and `tile` were added later as optional fields, so a
 * file without them reads as the default mascot, and an older build that reads a newer file keeps the
 * color.
 */

const readLogoColorPreference = Effect.fn("LogoColorPreference.read")((path: string) =>
  readPreferenceFile(path, (parsed): AppLogoColorPreference => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1) return { ...DEFAULT_PREFERENCE };
    return {
      color: isAppLogoColor(parsed.color) ? parsed.color : DEFAULT_PREFERENCE.color,
      shape: isAppLogoShape(parsed.shape) ? parsed.shape : DEFAULT_PREFERENCE.shape,
      tile: isAppLogoTile(parsed.tile) ? parsed.tile : DEFAULT_PREFERENCE.tile,
    };
  }).pipe(Effect.catch(() => Effect.succeed({ ...DEFAULT_PREFERENCE }))),
);

const writeLogoColorPreference = Effect.fn("LogoColorPreference.write")(function* (
  path: string,
  preference: AppLogoColorPreference,
) {
  const { color, shape, tile } = preference;
  yield* writePreferenceFile(path, { version: 1, color, shape, tile });
  return { color, shape, tile };
});

/**
 * The logo color the app icon and every window show, and the mascot and tile of the app icon. The
 * main process holds it because it sets the Dock and window icons, and it tells each window about a
 * change through `subscribe`.
 */
export class LogoColorService {
  readonly #path: string;
  readonly #listeners = new Set<(preference: AppLogoColorPreference) => void>();
  #preference: AppLogoColorPreference = { ...DEFAULT_PREFERENCE };
  #writes = Semaphore.makeUnsafe(1);

  constructor(input: { path: string }) {
    this.#path = input.path;
  }

  get preference(): AppLogoColorPreference {
    return { ...this.#preference };
  }

  /** Read the saved preference. Called once at startup, before the first window loads. */
  load(): Effect.Effect<AppLogoColorPreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#preference = yield* readLogoColorPreference(this.#path);
      return this.preference;
    });
  }

  /**
   * Serialized, as `LanguageService.set` is: each write renames its own temporary file into place,
   * so two quick choices could otherwise save the value the user moved away from. A field the change
   * does not name keeps its saved value.
   */
  set(change: SetAppLogoColorPreferenceInput): Effect.Effect<AppLogoColorPreference, PreferenceFileFailure> {
    return this.#writes.withPermit(this.#write(change));
  }

  #write(change: SetAppLogoColorPreferenceInput): Effect.Effect<AppLogoColorPreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#preference = yield* writeLogoColorPreference(this.#path, { ...this.#preference, ...change });
      for (const listener of this.#listeners) listener(this.preference);
      return this.preference;
    }).pipe(Effect.uninterruptible);
  }

  subscribe(listener: (preference: AppLogoColorPreference) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
