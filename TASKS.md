# Personal OpenBot tasks

## 1. Languages: English and Arabic (Egyptian) only, with RTL
- [ ] Add `ar` (Egyptian Arabic, `ar-EG`, Egyptian flag) to `APP_LANGUAGES` and `TRANSLATED_LOCALES`
- [ ] Add `packages/i18n/src/messages/ar/` catalogs and translate keys
- [ ] Add Arabic CLDR plural rule to `plural.ts` and label to `languages.ts`
- [ ] Add RTL: set `dir="rtl"` on `<html>` for Arabic in desktop, web and mobile; fix layout spots
- [ ] Remove de, es, fr, it, ja, ko, pl, pt, ru, tr, zh catalogs and all references
- [ ] Map saved removed-language preferences to `system` safely

## 2. Voice shortcut
- [ ] Find the mic / dictation code in the composer
- [ ] Add `V` key (when no text field has focus) to start the mic and send the task to agents
- [ ] Show the shortcut in the shortcuts list

## 3. Free self-hosted server on own VPS
- [ ] Map priced parts (billing, account service, hosted servers, Signal)
- [ ] Remove paywall / billing checks for the server feature
- [ ] Add a setting to connect to own VPS host URL
- [ ] Document VPS setup (`docs/self-hosted-server.md`)

## 4. Checks
- [ ] Run narrow typecheck and i18n check on changed files
