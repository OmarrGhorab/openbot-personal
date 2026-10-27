---
name: raven-stack-gates
description: "Run the project's quality gates (install, format, lint, typecheck, test, build) on the committed head, with default commands for Node and TypeScript, PHP and Laravel, Python, Go, Rust, Ruby, Java and Kotlin, .NET, Flutter, Swift and Elixir. Use before opening or updating a PR, and when verifying someone else's commit."
---

# Run the gates

Run every gate from the profile written by `$raven-stack-detect`, on your committed head (`git status` clean). Paste each command with its result line; a gate you didn't run is not green.

## Default commands

Use the project's own scripts first. These are the defaults when it has none.

| Stack | Install | Format | Lint | Typecheck | Test | Build |
| --- | --- | --- | --- | --- | --- | --- |
| Node, npm | `npm ci` | `npx prettier --check .` or `npx biome format .` if configured | `npm run lint` | `npx tsc --noEmit` | `npm test` | `npm run build` |
| Node, pnpm | `pnpm i --frozen-lockfile` | same through `pnpm exec` | `pnpm lint` | `pnpm exec tsc --noEmit` | `pnpm test` | `pnpm build` |
| Node, yarn | `yarn --immutable` (Berry) or `yarn --frozen-lockfile` (v1) | same through `yarn` | `yarn lint` | `yarn tsc --noEmit` | `yarn test` | `yarn build` |
| Node, bun | `bun i --frozen-lockfile` | same through `bunx` | `bun run lint` | `bunx tsc --noEmit` | `bun test` or `bun run test` | `bun run build` |
| Laravel | `composer install`, then the Node install for assets | `vendor/bin/pint --test` | `vendor/bin/phpstan analyse` if configured (Larastan) | the static analysis above | `php artisan test` (or `vendor/bin/pest`) | asset build, e.g. `npm run build` |
| Symfony, other PHP | `composer install` | `vendor/bin/php-cs-fixer fix --dry-run` or `vendor/bin/phpcs` | same | `vendor/bin/phpstan analyse` or `vendor/bin/psalm` | `vendor/bin/phpunit` or `vendor/bin/pest` | none |
| Python, uv | `uv sync` | `uv run ruff format --check .` | `uv run ruff check .` | `uv run mypy .` or `uv run pyright` | `uv run pytest` | `uv build` if published |
| Python, Poetry | `poetry sync` (or the lockfile install of older Poetry) | `poetry run ruff format --check .` or `black --check .` | `poetry run ruff check .` | `poetry run mypy .` | `poetry run pytest` | `poetry build` |
| Django | as above | as above | as above | as above | `python manage.py test` or `pytest` | `python manage.py check --deploy` |
| Go | `go mod download` | `test -z "$(gofmt -l .)"` | `go vet ./...` and `golangci-lint run` if configured | the build covers it | `go test ./...` (add `-race` when concurrency changed) | `go build ./...` |
| Rust | `cargo fetch` | `cargo fmt --check` | `cargo clippy --all-targets -- -D warnings` | the build covers it | `cargo test` | `cargo build --release` |
| Ruby, Rails | `bundle install` | `bundle exec rubocop` | same | `bundle exec srb tc` if Sorbet | `bin/rails test` or `bundle exec rspec` | `bin/rails assets:precompile` if relevant |
| Maven | `./mvnw -q dependency:resolve` | `./mvnw spotless:check` if configured | checkstyle or spotbugs goals | compile covers it | `./mvnw test` | `./mvnw package` |
| Gradle | `./gradlew dependencies` | `./gradlew spotlessCheck` or `ktlintCheck` | `./gradlew detekt` or `lint` (Android) | compile covers it | `./gradlew test` | `./gradlew build` |
| .NET | `dotnet restore` | `dotnet format --verify-no-changes` | analyzers in build (`-warnaserror`) | compile covers it | `dotnet test` | `dotnet build -c Release` |
| Flutter, Dart | `flutter pub get` | `dart format --set-exit-if-changed .` | `flutter analyze` | analyze covers it | `flutter test` | `flutter build <target>` |
| Swift | `swift package resolve` | `swiftformat --lint .` if configured | `swiftlint` | compile covers it | `swift test` or `xcodebuild test` | `swift build` |
| Elixir | `mix deps.get` | `mix format --check-formatted` | `mix credo --strict` | `mix dialyzer` if configured | `mix test` | `mix compile --warnings-as-errors` |

If a gate is "none configured", write that in the PR instead of inventing one.

## Rules

- Fix failures in your own code.
- A failure in code you didn't touch, on a fresh base, gets noted in the PR, not fixed. Check it fails on the base too.
- Never make a gate pass by weakening a test, adding `.skip` or `.only`, raising a threshold, loosening types, or adding ignore comments.
- When the change touches database-specific behaviour and tests run on a different engine than production, also run the lane that matches production, against a local or disposable database you created.
- Never run migrations, seeders or resets against a database you didn't create.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
