### Added

- Local development and the `omar` account deploy read a private env file
  (`~/.openbot-backend.env`, or `OPENBOT_BACKEND_ENV_FILE`). They do not need the upstream dotenvx key.
- `bun run api:ticket-keys` writes the ticket signing key into that file and does not print it.
- `bun run api:deploy:omar` and `bun run api:migrate:omar` target the free-tier `account` Worker.
  It binds `openbot-omar-avatars`, `openbot-omar-skills`, and `openbot-omar-sites`. A missing
  bucket binding still answers 503. See `docs/own-backend.md`.

### Fixed

- The SMTP username can be a login that is not an email address, such as Resend's `resend`. The
  sender address in `EMAIL_FROM` must still be an email address.

### Changed

- A local account Worker that has SMTP configured sends the sign-in code and still returns it in the
  development response.
