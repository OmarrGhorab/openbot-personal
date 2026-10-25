### Added

- Builds take the services they use from settings: `OPENBOT_SITE_URL`, `OPENBOT_ACCOUNT_URL`,
  `OPENBOT_SIGNAL_URL`, `OPENBOT_TEAM_HOST_DOMAIN`, `OPENBOT_ANALYTICS_URL`, `OPENBOT_ANALYTICS_CLIENT_ID`,
  `OPENBOT_UPDATE_FEED_URL`, `OPENBOT_STATUS_URL`, `OPENBOT_DISCORD_URL` and `OPENBOT_CONTACT_EMAIL`.
  See `docs/own-backend.md`.
- The account service reads its mail sender, SMTP host and contact address from its own settings.

### Changed

- Analytics and the desktop update check are off unless their settings are set. A build with no
  settings sends no analytics and checks no update feed.
- The desktop app builds for Windows x64 and macOS Intel (x64) only.
- Set your own services before you build. The defaults are placeholders that do not resolve, so
  a build with no settings cannot sign in, sync or send mail.
