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
- [x] Run narrow typecheck and i18n check on changed files (merged main: i18n:check, typecheck:i18n, typecheck:node, typecheck:renderer pass)

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
- [x] Install dependencies (pinned bun 1.4.2 through npx)
- [x] Biome and typecheck on changed files (pre-commit hook passed)
- [ ] Mobile: map shared OPENBOT_* settings into the Expo build (open, owner decision)
- [ ] Marketplace shareUrl: change generator in scripts/build-plugin-catalog.ts (open)
- [ ] Release scripts: keep four remote desktop targets or drop two (open, owner decision)
- [x] Commit and push feat/own-backend, merged into main

## 7. Omar account backend (branch cursor/omar-own-backend-1da1)
- [x] Private env file loader (`OPENBOT_BACKEND_ENV_FILE`, default `~/.openbot-backend.env`)
- [x] Ticket key script that appends the pair and does not print it
- [x] `dev:api` / `dev:all` load that file with no dotenvx key; SMTP sends when configured
- [x] Wrangler env `omar` binds the three openbot-omar R2 buckets. workers.dev only. Deploy does not read `.env.production`
- [x] Document D1, KV (none), rate limits, and the desktop `OPENBOT_ACCOUNT_URL`
- [x] Onboarding step order unchanged; test locks language, then sign-in, then first run
- [x] SMTP username may be a non-email login such as `resend`. `EMAIL_FROM` stays an email address
- [x] Narrow checks passed here. Pull request: https://github.com/OmarrGhorab/openbot-personal/pull/14

## 6. Global voice (branch feat/global-voice)
- [x] Merge origin/main (43eb450: Arabic/English dictation, Whisper default)
- [x] Contract: global voice preference, state, picker and command types, endpoints
- [x] Main: preference store, GlobalVoiceController (shortcuts, last agent, view state)
- [x] Main: picker window factory, IPC handlers with picker sender check, wiring, teardown ordinal 21
- [x] Preload bridge and decoders; preview mock
- [x] i18n globalVoice catalogs (en, ar) and error catalog
- [x] Renderer: one helper window with pill and picker views, recorder, Tab/Escape while listening
- [x] Settings > Voice: shortcut fields, send-after-speaking, registration status
- [x] Agent settings: direct shortcut per agent
- [ ] Hold-to-talk: NOT shipped (needs native key hook, Accessibility flow; not verifiable here)
- [x] changelog.d/feat-global-voice.md
- [x] Narrow checks: typecheck:node, typecheck:renderer, biome on changed files, sender-guard vitest
- [ ] Commit, push feat/global-voice (no PR)

## 8. Issues #50–#53 (local branches, no push)
### #50 Dynamic Island drag (feat/dynamic-island-drag)
- [x] Drag the island window by pointer, with a 4 px threshold so a click stays a click
- [x] Persist the window position per display in `dynamic-island-positions.json`
- [x] Clamp the saved position on display changes and keep the drawn island on screen
- [x] Do not drag from a button, link, field, select or editable element; suppress the click after a drag
- [x] Windows and Linux: start the island window and guard macOS-only calls
- [x] Clamp tests, typechecks and biome pass

### #53 Voice send reliability (fix/voice-send-reliability)
- [x] Send timeout in main (20 s) and in the window (25 s)
- [x] Visible Send and Cancel in review and Send while listening
- [x] Errors show in the review box and keep the text
- [x] i18n keys in English and Arabic; tests and typechecks pass

### #51 Dictation latency and model (not started)
- [ ] Add end-to-end latency marks (speech end to text shown)
- [ ] Warm the model when recording starts
- [ ] Compare Parakeet and Whisper on the same clips (done: Parakeet 0.43–0.99 s, Whisper 4.9–16.8 s; WER 0–11.1 % vs 0 %)
- [ ] Pick the default and keep the other model as fallback

### #52 Live transcript (not started)
- [ ] Stream PCM while recording and show partial text within 1 s
- [ ] Replace the partial text with the final text, with no duplicates
- [ ] Retry and replay the utterance after a dropped stream
