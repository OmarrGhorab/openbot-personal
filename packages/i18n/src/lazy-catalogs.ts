import type { appTranslation as AppTranslation } from "./app-catalogs";
import type { formatTranslation as FormatTranslation } from "./format-catalogs";
import type { TranslatedLocale } from "./locale";
import type { loadLocale as LoadLocale, localeLoaded as LocaleLoaded } from "./locale-loading";
import { messages as enFormat } from "./messages/en/format";
import { en } from "./messages/en/index";
import { source as enSource } from "./messages/en/source";
import type { sourceTranslation as SourceTranslation } from "./source-catalogs";

/**
 * The catalogs of the public web build: `app-catalogs.ts`, `source-catalogs.ts`,
 * `format-catalogs.ts` and `locale-loading.ts` in one module, which `apps/auth-api/vite.config.ts`
 * puts in their place.
 *
 * The site shows the desktop app as a demo and as the web client. English is part of the bundle,
 * and Egyptian Arabic is a chunk that loads on first use. Each export has the type of the module it
 * replaces, so the two builds cannot drift apart.
 */

interface LocaleCatalogs {
  app: NonNullable<ReturnType<typeof AppTranslation>>;
  source: NonNullable<ReturnType<typeof SourceTranslation>>;
  format: NonNullable<ReturnType<typeof FormatTranslation>>;
}

type LoadableLocale = Exclude<TranslatedLocale, "en">;

const loaders: Record<LoadableLocale, () => Promise<LocaleCatalogs>> = {
  ar: () =>
    Promise.all([import("./messages/ar/index"), import("./messages/ar/source"), import("./messages/ar/format")]).then(
      ([app, source, format]) => ({ app: app.ar, source: source.source, format: format.messages }),
    ),
};

const loaded = new Map<TranslatedLocale, LocaleCatalogs>([["en", { app: en, source: enSource, format: enFormat }]]);
const loading = new Map<LoadableLocale, Promise<void>>();

export const appTranslation: typeof AppTranslation = (locale) => loaded.get(locale)?.app;
export const sourceTranslation: typeof SourceTranslation = (locale) => loaded.get(locale)?.source;
export const formatTranslation: typeof FormatTranslation = (locale) => loaded.get(locale)?.format;
export const localeLoaded: typeof LocaleLoaded = (locale) => loaded.has(locale);

/** A failed load is not kept, so the next request for the language tries again. */
export const loadLocale: typeof LoadLocale = (locale) => {
  if (locale === "en" || loaded.has(locale)) return Promise.resolve();
  const pending = loading.get(locale);
  if (pending) return pending;
  const next = loaders[locale]().then(
    (catalogs) => {
      loaded.set(locale, catalogs);
      loading.delete(locale);
    },
    (error: unknown) => {
      loading.delete(locale);
      throw error;
    },
  );
  loading.set(locale, next);
  return next;
};
