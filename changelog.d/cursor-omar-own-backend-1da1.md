### Added

- Local development and the `omar` account deploy read a private env file
  (`~/.openbot-backend.env`, or `OPENBOT_BACKEND_ENV_FILE`). They do not need the upstream dotenvx key.
- `bun run api:ticket-keys` writes the ticket signing key into that file and does not print it.
- `bun run api:deploy:omar` and `bun run api:migrate:omar` target the free-tier `account` Worker.
  R2 stays off. See `docs/own-backend.md`.

### Changed

- A local account Worker that has SMTP configured sends the sign-in code and still returns it in the
  development response.
