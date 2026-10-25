# Run OpenBot on your own backend

This fork does not contact the upstream project's services. Your build uses your own website,
account service, Signal service and analytics. This guide lists the settings, how to deploy the two
server parts, and how to build the desktop app.

Read it with [apps/auth-api/README.md](../apps/auth-api/README.md), which covers the account Worker
in more depth, and [remote/README.md](../remote/README.md), which covers Signal.

## What the fork changes

- Every host that the desktop app, the account Worker, the team client and the mobile app used to
  call is now a build setting. The defaults are placeholders on the reserved `.invalid` domain. They
  never resolve, so a build with no settings fails closed and reaches no upstream service.
- Analytics is off unless you set both `OPENBOT_ANALYTICS_URL` and `OPENBOT_ANALYTICS_CLIENT_ID`.
- The desktop auto-update check is off unless you set `OPENBOT_UPDATE_FEED_URL`.
- The account Worker reads the email sender, the SMTP host and the contact address from your own
  settings. Nothing in the code sends mail as the upstream sender.
- The GitHub Actions jobs that publish, deploy, announce or sign with upstream accounts run only on
  the `nightly-labs/openbot` repository. The test jobs still run on the fork.
- Desktop builds target Windows x64 and macOS Intel (x64) only.

The shared settings are read by `packages/contracts/src/own-backend.ts`. It has no imports, so the
desktop main process, the preload script, the renderer, the team client and the account Worker can
all use it.

## Build-time settings

Set these in the shell before you build the desktop app or the account Worker. The Vite builds read
them with `ownBackendBuildDefines` (see `electron.vite.config.ts` and `apps/auth-api/vite.config.ts`).
An empty value means the default. A value that is set but invalid stops the build with a message
that names the setting. The message never shows the value.

| Setting | Default | Purpose |
| --- | --- | --- |
| `OPENBOT_SITE_URL` | `https://openbot.invalid` | Public website origin. Invitation, plugin and agent share links, and canonical redirects. |
| `OPENBOT_ACCOUNT_URL` | `https://account.openbot.invalid` | Account Worker origin. Sign-in, accounts, avatars, host configuration and invitations. |
| `OPENBOT_SIGNAL_URL` | `wss://signal.openbot.invalid/v1/signal` | Signal socket. Remote sessions, relays, Slack, Discord and Telegram routes. |
| `OPENBOT_TEAM_HOST_DOMAIN` | `openbot.invalid` | Domain of team hosts, named `<slug>-<id>-host.<domain>`. |
| `OPENBOT_ANALYTICS_URL` | empty (off) | OpenPanel API URL, for example `https://analytics.example.com/api`. |
| `OPENBOT_ANALYTICS_CLIENT_ID` | empty (off) | OpenPanel client id. Analytics is on only when both analytics settings are set. |
| `OPENBOT_UPDATE_FEED_URL` | empty (off) | Desktop update feed. Must match `publish.url` in `electron-builder.yml`. |
| `OPENBOT_STATUS_URL` | empty (no link) | Status page origin, shown as a link. |
| `OPENBOT_DISCORD_URL` | empty (no link) | Community link. Without it, the Discord link opens the site. |
| `OPENBOT_CONTACT_EMAIL` | placeholder (`contact@openbot.invalid`) | Contact address on the account Worker's pages. Set it to your own address. |

For the mobile app, Expo inlines only `EXPO_PUBLIC_*` names. Set `EXPO_PUBLIC_OPENBOT_ANALYTICS_URL`,
`EXPO_PUBLIC_OPENBOT_SITE_URL`, `EXPO_PUBLIC_OPENPANEL_CLIENT_ID` and `EXPO_PUBLIC_OPENPANEL_CLIENT_SECRET`.
The shared `OPENBOT_*` settings do not reach the mobile bundle yet. See the open items below.

## DNS and domains

Choose one domain you control, for example `example.com`. Create these records.

| Name | Points to | Used by |
| --- | --- | --- |
| `example.com` | your website host | `OPENBOT_SITE_URL` |
| `account.example.com` | the account Worker (a Worker route or custom domain) | `OPENBOT_ACCOUNT_URL` |
| `signal.example.com` | the Signal host (see `remote/README.md`) | `OPENBOT_SIGNAL_URL` |
| `*.example.com` for team hosts | your team host machines | `OPENBOT_TEAM_HOST_DOMAIN` |
| `analytics.example.com` (optional) | your OpenPanel instance | `OPENBOT_ANALYTICS_URL` |

Use TLS certificates for every name. The desktop app accepts plain HTTP only for `localhost`,
`127.0.0.1` and `[::1]`, which a developer uses.

## Deploy the account Worker (`apps/auth-api`)

1. Edit `apps/auth-api/wrangler.jsonc`. Replace the routes, the zone id, the D1 database id, the R2
   bucket names and the rate-limit namespace ids with your own. The fork does not change these.
2. Set the email settings. Use one SMTP provider of your own. Set all four or none. With none, email
   is off.
   - `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USERNAME` and `EMAIL_FROM` go in `wrangler.jsonc`
     `vars`, in each environment block. `EMAIL_FROM` is the sender address. Use an address on a domain you
     control.
   - `EMAIL_SMTP_PASSWORD` is a secret: `wrangler secret put EMAIL_SMTP_PASSWORD`.
3. Set the service settings the Worker reads at run time. `REMOTE_SIGNAL_URL` is your Signal socket.
   `REMOTE_AUTH_WEBHOOK_URL` is your Signal `/internal/auth-events` URL, and its secret is
   `REMOTE_AUTH_WEBHOOK_SECRET`. The GitHub App, APNs and FCM values are empty in the fork. Set them
   only when you have your own apps.
4. Do not run `bun run api:deploy`. That script decrypts `apps/auth-api/.env.production` with the
   upstream production key, which you do not have. Use the private file and `bun run api:deploy:omar`
   in the next section.
5. Apply the D1 migrations first, as `apps/auth-api/AGENTS.md` describes, then deploy the Worker.

The Worker's `OPENBOT_*` values are fixed at build time. Rebuild and deploy after you change them.

## Private account file

Local development and the `omar` deploy read a plain env file. They do not need `DOTENV_PRIVATE_KEY_DEV`
or the encrypted `.env.dev` and `.env.production` files.

The default path is `~/.openbot-backend.env`. Set `OPENBOT_BACKEND_ENV_FILE` to use another path.
The file stays outside the repository. Set its mode to `600`. Do not commit it. `.env.local`,
`.dev.vars`, and a copy named `.openbot-backend.env` inside the repo are gitignored.
`apps/auth-api/omar.env.example` lists the names with empty secrets.

```sh
bun run api:ticket-keys
```

That command appends `REMOTE_TICKET_PRIVATE_JWK` and `REMOTE_TICKET_PUBLIC_JWKS` to the private file.
It does not print the key. Run it again and the same key stays. `--rotate` replaces it.

`bun run dev:api` and `bun run dev:all` load this file with no dotenvx key. Development still returns
the sign-in code in the API response (`AUTH_EXPOSE_DEVELOPMENT_CODE`). When the file has all five SMTP
settings, the same code is also sent by email. The mail host is Resend: `smtp.resend.com`, port `465`,
user `resend`. Put `EMAIL_SMTP_PASSWORD` and `EMAIL_FROM` only in the private file.

Load order for local development: generated defaults, decrypted `.env.dev` when you have the key,
the private file, saved overrides in `.openbot/dev-state.json`, then the shell. The private file
does not turn the development code flag off. The shell can.

## Deploy the omar account Worker

`apps/auth-api/wrangler.jsonc` environment `omar` is a free-tier Worker. Its name is `account`, so
the origin is `https://account.omarghorabdev.workers.dev`. It has no custom domain and no zone.
Do not change DNS for `randomlychat.app`. Do not deploy or edit the `randomchat-deadman` Worker.

R2 is off. Cloudflare asks for a payment method before R2 can be enabled, so this environment binds
no bucket. These features answer `503 object_storage_unavailable`:

- Account and host avatars
- Skill and agent marketplace files (the bundle, the icon, the avatar, and the share card)
- Hosted sites

Sign-in, accounts, sessions, and the other D1 data still work. Hosted server purchase stays off.
There is no Stripe key and no analytics client. Workers Logs are off.

Create these Cloudflare resources in account `f77ab81c787067b7c3ce1632449bfd68` before you deploy.
Use `wrangler login` for that account. Do not use the upstream production file.

| Resource | Name | Create |
| --- | --- | --- |
| D1 database | `openbot-auth-omar` | `cd apps/auth-api && bunx wrangler d1 create openbot-auth-omar` |
| KV namespace | none | This Worker does not use KV. |
| Rate limit `MARKETPLACE_INGRESS_RATE_LIMITER` | namespace `2026102501` | Declared in `env.omar`. No separate create command. |
| Rate limit `MARKETPLACE_MUTATION_RATE_LIMITER` | namespace `2026102502` | Same. |
| Rate limit `MARKETPLACE_UPLOAD_RATE_LIMITER` | namespace `2026102503` | Same. |
| Rate limit `SITE_REPORT_RATE_LIMITER` | namespace `2026102504` | Same. |
| Rate limit `GITHUB_TOKEN_RATE_LIMITER` | namespace `2026102505` | Same. |
| Rate limit `LIVE_ACTIVITY_RATE_LIMITER` | namespace `2026102506` | Same. |

Paste the D1 database id into `env.omar` `database_id`. The placeholder
`00000000-0000-4000-8000-000000000000` blocks migrate and deploy.

```sh
bun run api:migrate:omar
bun run api:deploy:omar
```

`api:migrate:omar` applies the D1 migrations to the remote `omar` database.
`api:deploy:omar` uploads the private-file secrets with `wrangler secret put --env omar`, applies
those migrations, builds, and deploys. It does not read `.env.production`. It sets
`OPENBOT_ACCOUNT_URL` to `https://account.omarghorabdev.workers.dev` when the shell does not set it.
A `CLOUDFLARE_API_TOKEN` in the shell is ignored. Put a token in the private file only when you do
not use `wrangler login`.

## Build the desktop app against this account

Set `OPENBOT_ACCOUNT_URL` to the Worker origin, then build. This changes where account requests go.
It does not change onboarding.

```sh
export OPENBOT_ACCOUNT_URL=https://account.omarghorabdev.workers.dev
# Optional. Do not change DNS for this name.
# export OPENBOT_SITE_URL=https://randomlychat.app
export OPENBOT_SIGNAL_URL=wss://signal.openbot.invalid/v1/signal
export OPENBOT_TEAM_HOST_DOMAIN=openbot.invalid

bun run dist:mac   # macOS Intel (x64) on an Intel Mac
bun run dist:win   # Windows x64
```

For local development the app uses the local Worker URL that `bun run dev` prints. You do not set
`OPENBOT_ACCOUNT_URL` for that.

## Deploy Signal (`remote/`)

Signal runs on a server you control. Follow [remote/README.md](../remote/README.md).

1. Create `remote/.env.production` from `remote/.env.example`. Set `SIGNAL_DOMAIN`, `TURN_DOMAIN`,
   `TURN_PUBLIC_IP`, `ACME_EMAIL`, `REMOTE_CONTROL_PLANE_URL` (your account origin),
   `REMOTE_TICKET_JWKS_URL` (`https://account.example.com/.well-known/jwks.json`) and the secrets
   listed in the example.
2. The committed `remote/.env.production` holds the upstream JWKS and control-plane URLs. Replace
   those values with your own. You cannot decrypt the upstream copy, so write a new file with your
   own keys. Use `remote/.env.keys` only for your own key pair.
3. Run `bun run remote:env:validate`, then `bun run remote:up`, then `bun run remote:check`.
4. Slack, Discord and Telegram routes need your own apps. Their manifests in `apps/slack-app/` and
   `apps/discord-app/` point at the upstream hosts. Create your own apps, then set their callback
   URLs to your account and Signal origins.

## Build the desktop app

Set the build-time settings, then run one command:

```sh
export OPENBOT_SITE_URL=https://example.com
export OPENBOT_ACCOUNT_URL=https://account.example.com
export OPENBOT_SIGNAL_URL=wss://signal.example.com/v1/signal
export OPENBOT_TEAM_HOST_DOMAIN=example.com
# Optional:
# export OPENBOT_ANALYTICS_URL=https://analytics.example.com/api
# export OPENBOT_ANALYTICS_CLIENT_ID=<your-openpanel-client-id>
# export OPENBOT_UPDATE_FEED_URL=https://updates.example.com/desktop

bun run dist:mac   # macOS Intel (x64) on an Intel Mac
bun run dist:win   # Windows x64
```

The packaged app reads these values at build time. Build again after you change them.

To turn on auto-update, set `OPENBOT_UPDATE_FEED_URL` and set `publish.url` in `electron-builder.yml`
to the same URL. Serve the `latest*.yml` files that electron-builder writes at that URL. The fork
ships a placeholder `publish.url` on `updates.openbot.invalid`. Until you change it, the app does not
check for updates.

## GitHub Actions

Jobs for upstream deploys, releases, announcements, the CLA, the contribution policy, the NorbiAI
review, the status page, Cloudflare previews and app-store uploads run only when
`github.repository == 'nightly-labs/openbot'`. In your fork they are skipped. The test and check jobs in
`ci.yml` still run. The macOS and Windows release jobs also need your own signing identities, which the
fork does not have. A dry run runs unsigned.

## Open items

These are not changed in this pass. Each one is still tied to the upstream project.

- The mobile app reads the shared `OPENBOT_*` settings through `process.env`. Expo does not inline
  them, so the mobile bundle uses the placeholders. The mobile analytics and About link read
  `EXPO_PUBLIC_*` names instead. A mapping for the shared settings is still needed.
- The marketplace listing `shareUrl` values under `https://openbot.run/plugins/` are generated by
  `scripts/build-plugin-catalog.ts` from `marketplace/plugin-catalog/`. Change the generator, then
  regenerate.
- Download links and the install script point at the upstream GitHub releases
  (`apps/auth-api/src/server/latest-download.ts`, `apps/auth-api/src/lib/download-pages.ts`).
- Hosted sites use the `openbot.site` domain (`apps/auth-api/src/server/hosted-site-service.ts`). Choose a
  domain for them, or disable hosted sites.
- Some visible text still names `openbot.run`. This includes some email copy, some i18n catalogs (for
  example `packages/i18n/src/messages/*/onboarding.ts`) and the join-dialog placeholder in
  `packages/ui/src/features/servers/JoinServerDialog.tsx`.
- The release scripts still require all four remote desktop runtime targets, including
  `darwin-arm64` and `linux-x64` (`scripts/remote-desktop-runtime-release.ts`,
  `scripts/create-remote-desktop-release-manifest.ts`). The native runtime lock still lists those
  pins. They are data for other platforms, so the lock is unchanged.
- The `dist:linux` and `package:linux` scripts still exist. The Linux app and its server bundle are no
  longer built by the release configuration.
- `PRIVACY.md` still describes the upstream analytics and services. Update it for your build.
- The Docker image and the `scripts/hosting` server bundle were part of the Linux build. A VPS host
  that installs from a desktop release needs another way to get them.
