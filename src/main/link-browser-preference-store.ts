import { type AppLinkBrowserPreference, DEFAULT_APP_LINK_BROWSER, isAppLinkBrowser } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * Where links from conversations open. `openUrl` reads it for each link, so it is held in memory
 * after `load` rather than read from disk each time.
 *
 * A file that is missing, unreadable as JSON or names a browser this build does not offer reads as
 * the default browser, which is where every link opened before the setting worked. Writes are
 * chained for the reason `busy-message-mode-preference-store.ts` chains its own.
 */
export class LinkBrowserPreferenceStore {
  readonly #path: string;
  #preference: AppLinkBrowserPreference = { browser: DEFAULT_APP_LINK_BROWSER };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): AppLinkBrowserPreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isAppLinkBrowser(parsed.browser)
            ? { browser: parsed.browser }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): AppLinkBrowserPreference {
    return { ...this.#preference };
  }

  readonly set = Effect.fn("AppLinkBrowserPreference.set")(function* (
    this: LinkBrowserPreferenceStore,
    { browser }: AppLinkBrowserPreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, browser }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#preference = { browser };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
