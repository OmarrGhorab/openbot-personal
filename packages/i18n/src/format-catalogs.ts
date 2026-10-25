import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { messages as ar } from "./messages/ar/format";
import { messages as en } from "./messages/en/format";

const catalogs = { en, ar } as const;

/** The format catalog of `locale`, or `undefined` while it is not loaded. See `app-catalogs.ts`. */
export function formatTranslation(locale: TranslatedLocale): PartialTranslation<typeof en> | undefined {
  return catalogs[locale];
}
