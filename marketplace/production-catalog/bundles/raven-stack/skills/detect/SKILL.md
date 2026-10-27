---
name: raven-stack-detect
description: "Detect a repository's languages, frameworks, package managers and tooling from its manifests, lockfiles and CI, then fill the command map (install, format, lint, typecheck, test, build, run) for each package. Use at the start of any coding task, or when you don't know a project's commands."
---

# Detect the stack

Write a profile for each package before you touch code. It is the gate list for the rest of the task.

## 1. Find the packages

Start at the repository root. In a monorepo, also check every workspace: folders named in `pnpm-workspace.yaml`, the `workspaces` field of `package.json`, `go.work`, the `[workspace]` of `Cargo.toml`, `settings.gradle`, `*.sln`, or common folders (`apps/*`, `packages/*`, `services/*`, `backend/`, `frontend/`).

## 2. Read the manifests

| Manifest | Language | Look further at |
| --- | --- | --- |
| `package.json` | JavaScript / TypeScript | lockfile: `package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn, `bun.lock` or `bun.lockb` bun; `tsconfig.json`; `scripts`; framework deps (`next`, `react`, `vue`, `nuxt`, `svelte`, `@angular/core`, `express`, `@nestjs/core`, `electron`, `react-native`, `expo`); test runner (`vitest`, `jest`, `@playwright/test`, `cypress`, `mocha`); lint and format (`eslint`, `@biomejs/biome`, `prettier`, `oxlint`) |
| `composer.json` | PHP | `laravel/framework` and `artisan` (Laravel), `symfony/*` (Symfony), `phpunit.xml`, `pestphp/pest`, `laravel/pint`, `phpstan.neon`, `psalm.xml`, `.php-cs-fixer.php` |
| `pyproject.toml`, `requirements*.txt`, `setup.py`, `Pipfile` | Python | `uv.lock` uv, `poetry.lock` Poetry, `Pipfile.lock` pipenv; `manage.py` Django; `fastapi`, `flask`; `pytest`, `ruff`, `black`, `mypy`, `pyright`, `tox.ini`, `noxfile.py` |
| `go.mod` | Go | `.golangci.yml`, `Makefile`, `cmd/` entry points |
| `Cargo.toml` | Rust | workspace members, `clippy.toml`, `rustfmt.toml`, `rust-toolchain.toml` |
| `Gemfile` | Ruby | `rails` and `bin/rails` (Rails), `.rspec`, `.rubocop.yml` |
| `pom.xml` | Java / Kotlin, Maven | `mvnw`, `spring-boot`, checkstyle, spotless |
| `build.gradle`, `build.gradle.kts` | Java / Kotlin, Gradle | `gradlew`, Android plugin, `ktlint`, `detekt` |
| `*.csproj`, `*.sln` | C# / .NET | test projects (`xunit`, `nunit`, `mstest`), `.editorconfig` |
| `pubspec.yaml` | Dart / Flutter | `flutter` SDK dependency, `analysis_options.yaml` |
| `Package.swift`, `*.xcodeproj` | Swift | `.swiftlint.yml`, test targets |
| `mix.exs` | Elixir | Phoenix, `credo`, `.formatter.exs` |

Also note `Makefile` or `justfile` targets, `Dockerfile` and compose files, `.tool-versions`, `.nvmrc`, `.python-version`, `.env.example` (names only, never values), and the CI workflows (`.github/workflows/*`, `.gitlab-ci.yml`, `.circleci/`). CI shows the exact commands the project trusts, so prefer them over defaults.

## 3. Check the toolchain

Compare the version the project requires (the `engines` field, `.nvmrc`, `require.php`, `requires-python`, the `go` directive, `rust-toolchain.toml`) with the binary on PATH. If several are installed, pick the matching one and keep using that same binary for install, run and test in this task. A mismatch is a likely cause of "works in CI, fails here".

## 4. Fill the command map

Use the project's own scripts first: `package.json` scripts, `composer` scripts, Makefile or justfile targets, CI steps. Otherwise use the defaults in `$raven-stack-gates`. For each package, write:

```
package: <path>
stack: <language> / <framework> / <package manager> / <test runner>
install:   <command>
format:    <command or "none configured">
lint:      <command or "none configured">
typecheck: <command or "none configured">
test:      <command>
build:     <command or "none">
run:       <command and port>
db:        <engine and how tests reach it, or none>
```

## Fallback

If the stack is not listed or a command is missing, look in this order: CI workflow steps, Makefile or justfile targets, the README, the framework's standard command. If a gate truly does not exist, write "none configured" instead of inventing one, and lean harder on live evidence. If the test config uses a different database or driver than production (for example SQLite in tests, MySQL or Postgres in production), note it: changes to database-specific behaviour need the lane that matches production.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
