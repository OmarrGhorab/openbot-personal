# Personal OpenBot tasks

## 1. Languages: English and Arabic (Egyptian) only, with RTL
- [x] Add `ar` (Egyptian Arabic, `ar-EG`, Egyptian flag) to `APP_LANGUAGES` and `TRANSLATED_LOCALES`
- [x] Add `packages/i18n/src/messages/ar/` catalogs and translate keys (all 9447 keys)
- [x] Add Arabic CLDR plural rule to `plural.ts` and label to `languages.ts`
- [x] Add RTL: set `dir="rtl"` on `<html>` for Arabic in desktop, web and mobile; fix layout spots
- [x] Remove de, es, fr, it, ja, ko, pl, pt, ru, tr, zh catalogs and all references
- [x] Map saved removed-language preferences to `system` safely
- [ ] Device check: mobile RTL needs a launch on an Arabic phone (not confirmed)
- [ ] Decide: dictation languages (`SPEECH_LANGUAGES`, `language.name.*`) stay; confirm
- [ ] Review Arabic copy by a native speaker (machine draft, Egyptian colloquial)
- [ ] Old `whats-new-releases.json` entries still name removed languages (history); decide
- [ ] Run `bun run i18n:check` in CI and `bun scripts/i18n-fit-e2e.ts --locales=ar` for layout fit

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
