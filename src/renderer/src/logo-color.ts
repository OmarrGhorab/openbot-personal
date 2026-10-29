import {
  APP_LOGO_COLOR_HEX,
  APP_LOGO_EYE_HEX,
  type AppLogoColor,
  type AppLogoColorPreference,
  type AppLogoShape,
  type AppLogoTile,
  DEFAULT_APP_LOGO_COLOR,
  DEFAULT_APP_LOGO_SHAPE,
  DEFAULT_APP_LOGO_TILE,
  type SetAppLogoColorPreferenceInput,
} from "@openbot/contracts/ipc";
import { createSignal, onSettled } from "solid-js";
import { appPort } from "./app-port";

const MASCOT_THUMBNAILS: Record<string, string> = import.meta.glob("./assets/mascots/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The Settings picture of a mascot in a logo color. */
export function mascotThumbnailUrl(shape: AppLogoShape, color: AppLogoColor): string {
  return MASCOT_THUMBNAILS[`./assets/mascots/${shape}-${color}.png`] ?? "";
}

/** Sets the release logo color and its eye color in this window. */
function applyLogoColor(color: AppLogoColor): void {
  document.documentElement.style.setProperty("--openbot-logo-production", APP_LOGO_COLOR_HEX[color]);
  document.documentElement.style.setProperty("--openbot-logo-production-eye", APP_LOGO_EYE_HEX[color]);
}

/**
 * Keeps this window on the saved logo color. Every window runs it, the Dynamic Island too, because
 * the island has no Settings of its own and main broadcasts each change to every window. Only a
 * release build applies it: some logos draw the release variant in every build, and a dev or preview
 * build keeps its own color. The preview calls the returned function when it unmounts, so the next
 * story starts from the brand tokens.
 */
export function syncLogoColor(): () => void {
  let active = true;
  const release = appPort()
    .getAppInfo()
    .then((info) => info.variant === "production")
    .catch(() => false);
  const apply = (color: AppLogoColor) => {
    void release.then((isRelease) => {
      if (active && isRelease) applyLogoColor(color);
    });
  };
  void appPort()
    .getAppLogoColorPreference()
    .then((preference) => apply(preference.color))
    .catch(() => undefined);
  const unsubscribe = appPort().onAppLogoColorPreference((preference) => apply(preference.color));
  return () => {
    active = false;
    unsubscribe();
    document.documentElement.style.removeProperty("--openbot-logo-production");
    document.documentElement.style.removeProperty("--openbot-logo-production-eye");
  };
}

/** The Settings control state. Set optimistically, and reverted if main refuses the write. */
export function useLogoColorChoice() {
  const [preference, setPreference] = createSignal<AppLogoColorPreference>({
    color: DEFAULT_APP_LOGO_COLOR,
    shape: DEFAULT_APP_LOGO_SHAPE,
    tile: DEFAULT_APP_LOGO_TILE,
  });
  let confirmed = preference();
  let latestRequest = 0;
  let pending = 0;

  /** A saved value from main. A choice that is still in flight is newer, so it stays on screen. */
  function confirm(next: AppLogoColorPreference): void {
    confirmed = next;
    if (pending === 0) setPreference(next);
  }

  function change(next: SetAppLogoColorPreferenceInput): void {
    const request = ++latestRequest;
    pending += 1;
    setPreference((current) => ({ ...current, ...next }));
    void appPort()
      .setAppLogoColorPreference(next)
      .then((saved) => {
        confirmed = saved;
        if (request === latestRequest) setPreference(saved);
      })
      .catch(() => {
        if (request === latestRequest) setPreference(confirmed);
      })
      .finally(() => {
        pending -= 1;
      });
  }

  onSettled(() => {
    void appPort()
      .getAppLogoColorPreference()
      .then(confirm)
      .catch(() => undefined);
    return appPort().onAppLogoColorPreference(confirm);
  });

  return {
    color: () => preference().color,
    shape: () => preference().shape,
    tile: () => preference().tile,
    changeColor: (color: AppLogoColor) => change({ color }),
    changeShape: (shape: AppLogoShape) => change({ shape }),
    changeTile: (tile: AppLogoTile) => change({ tile }),
  };
}
