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
- [x] Find the mic / dictation code in the composer
- [x] Add `V` key (when no text field has focus) to start the mic and send the task to agents (same as the mic button: the text is added to the message, not sent)
- [x] Show the shortcut in the shortcuts list (the app has no shortcut list; it shows in the mic button tooltip and `aria-keyshortcuts`)

## 3. Free self-hosted server on own VPS
- [x] Map priced parts (billing, account service, hosted servers, Signal)
- [x] Remove paywall / billing checks for the server feature (one switch: `HOSTED_SERVER_PURCHASES_ENABLED` in `packages/contracts/src/hosted-servers.ts`, read by `src/main/hosted-server-service.ts` `list()`)
- [x] Add a setting to connect to own VPS host URL (not added: the app reaches a host by host ID through Signal, and the existing `OPENBOT_AUTH_API_URL` / `OPENBOT_REMOTE_SIGNAL_URL` flow already covers a self-hosted account service)
- [x] Document VPS setup (`docs/self-hosted-server.md`, section VPS setup)
- [ ] Web client still reads the account `available` flag directly (`src/renderer/src/features/web-client/web-hosted-server-state.ts`), so hosted purchase prompts remain there
- [ ] Account service still accepts hosted server creates for accounts on its allow list (server side, not changed)
- [ ] Verify on a real VPS: install, `openbot login`, desktop sees the server (not run)

## 4. Checks
- [ ] Run narrow typecheck and i18n check on changed files
