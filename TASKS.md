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

## 5. Own backend (branch feat/own-backend)
- [x] Inventory upstream endpoints (table in the report and docs/own-backend.md)
- [x] Central config module `packages/contracts/src/own-backend.ts` with placeholder defaults
- [x] Replace upstream hosts in desktop main, renderer, team client, telemetry, CSP and contracts
- [x] Account Worker: email sender, SMTP and contact address from owner settings (fork workstream)
- [x] Disable analytics and auto-update to upstream unless their settings are set
- [x] Disable upstream-only GitHub Actions jobs and workflows (guard on nightly-labs/openbot)
- [x] Build only Windows x64 and macOS Intel (x64): electron-builder targets, workflow matrices, cua-driver
- [x] Mac release repository check and tenant test now run on the x64 job
- [x] Write docs/own-backend.md and changelog.d/feat-own-backend.md
- [ ] Install dependencies (`bun` not on this machine; not verified)
- [ ] Biome, typecheck and narrow tests on changed files (blocked by missing bun; not verified)
- [ ] Mobile: map shared OPENBOT_* settings into the Expo build (open, owner decision)
- [ ] Marketplace shareUrl: change generator in scripts/build-plugin-catalog.ts (open)
- [ ] Release scripts: keep four remote desktop targets or drop two (open, owner decision)
- [ ] Commit and push feat/own-backend (no PR)
