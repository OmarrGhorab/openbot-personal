---
name: raven-stack-build
description: "Implement the planned change in small commits in the codebase's own style, with tests that assert user-visible behaviour and red-then-green history for bug fixes. Use after the plan and BEFORE evidence exist, and for each fix round."
---

# Build small

Make the smallest change that meets the criteria.

## Steps

1. Copy the pattern the plan named. Reuse existing components, services, helpers and test utilities before writing new ones. Don't add a dependency the plan didn't call for.
2. **Bug fix, red first.** When there is a cheap test path, write the test that reproduces the bug, run it and see it fail, then commit it on its own:
   ```bash
   git add <test file> && git commit -m "test(<area>): reproduce <bug in plain words>"
   ```
   Then fix, see it pass, and commit the fix. History shows red, then green.
3. **Feature.** Add or update tests that assert what a user would notice (a rendered result, a response body, a stored row), not that a mock was called.
4. Run the single relevant test file often while you work, for example `npx vitest run <file>`, `php artisan test --filter=<Name>`, `pytest <path> -k <name>`, `go test ./<pkg> -run <Name>`, `cargo test <name>`, `bundle exec rspec <file>`, `dotnet test --filter <Name>`.
5. Commit in small steps:
   ```
   <category>(<area>): <plain summary>
   ```
   Same categories as the branch. User-facing first, no filler, plain words (see `$raven-stack-unslop`). Examples: `bug(export): CSV download includes the header row again`, `feat(settings): users can change their timezone`.

## Stay in scope

- Note related problems as follow-ups instead of fixing them.
- Don't reformat or restyle files you didn't need to touch.
- No debug leftovers: console logs, `dd()`, `print`, commented-out code, `.only` or `.skip`.
- Never loosen a type, disable a check or swallow an error to get past a gate.
- Never commit secrets, env files, local databases, or generated artifacts the project ignores.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
