import {
  type AppLanguage,
  DEFAULT_APP_LANGUAGE,
  isAppLanguage,
  localeDirection,
  resolveLocale,
} from "@openbot/i18n/mobile";
import * as SecureStore from "expo-secure-store";
import { I18nManager } from "react-native";
import { create } from "zustand";
import { phoneLanguages } from "@/shared/lib/phone-languages";

/**
 * The interface language on this phone. `"system"` follows the phone's first language. The desktop
 * keeps its own setting: a phone and a computer can read in different languages.
 */
const key = "openbot.mobile.app-language.v1";
export const useAppLanguage = create<{ value: AppLanguage; ready: boolean; saving: boolean }>(() => ({
  value: DEFAULT_APP_LANGUAGE,
  ready: false,
  saving: false,
}));

/**
 * Arabic lays the app out from the right. `I18nManager` keeps the direction it had at launch, so a
 * change here takes effect on the next full launch (not confirmed on a device).
 */
function applyLayoutDirection(value: AppLanguage): void {
  const rtl = localeDirection(resolveLocale(value, phoneLanguages()[0] ?? "en")) === "rtl";
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
}

export async function loadAppLanguage(): Promise<void> {
  if (useAppLanguage.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A value from a newer build that ships a language this one does not is ignored, not shown.
    // A second startup read must not overwrite a change made in Settings.
    if (isAppLanguage(stored) && !useAppLanguage.getState().ready) useAppLanguage.setState({ value: stored });
  } finally {
    useAppLanguage.setState({ ready: true });
    applyLayoutDirection(useAppLanguage.getState().value);
  }
}

export async function saveAppLanguage(value: AppLanguage): Promise<void> {
  if (!useAppLanguage.getState().ready || useAppLanguage.getState().saving) return;
  // Apply immediately, including when storage fails. Settings offers a retry.
  useAppLanguage.setState({ value, saving: true });
  applyLayoutDirection(value);
  try {
    await SecureStore.setItemAsync(key, value);
  } finally {
    useAppLanguage.setState({ saving: false });
  }
}
