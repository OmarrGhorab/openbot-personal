---
name: raven-stack-worktree
description: "Isolate one task in its own Git worktree and branch from the fresh base, named <category>/<id>-<slug>, with its own install and dev-server port. Use before you change any code, or when another task or agent shares the checkout."
---

# Isolate in a worktree

Every task gets its own worktree and branch. Never work in a checkout another task or agent is using, and never stash or switch someone else's work.

## Steps

If you are already in a worktree made for this task (`git rev-parse --git-dir` contains `/worktrees/`), reuse it. Otherwise:

```bash
git fetch origin
git worktree add -b <category>/<id>-<slug> ../<repo>-<id> origin/<base>
cd ../<repo>-<id>
git rev-parse origin/<base>        # record this as the base commit
```

In a fix round the branch already exists: `git switch <branch>` in its worktree instead.

Then run the install command from `$raven-stack-detect` inside the worktree, and copy any example env file to a local one with test values only (`cp .env.example .env`, then the framework's key or setup command, such as `php artisan key:generate` for Laravel). Never copy a production env file.

## Branch names

`<category>/<id>-<slug>`, lowercase, hyphenated, short.

| Category | When |
| --- | --- |
| `feat` | default: new behaviour |
| `bug` | a user-reported defect |
| `fix` | a regression of shipped behaviour |
| `refactor` | same behaviour, better structure |
| `perf` | measured speed or size change |
| `docs`, `chore`, `test` | when the kind is clear |

Use the issue key as `<id>`, or `lite` when there is none: `feat/lite-export-csv`.

## Ports

Use only your assigned dev-server port. Before trusting a page, check that the port is served by your own process (`lsof -i :<port>` on macOS and Linux, `netstat -ano | findstr :<port>` on Windows). Use your port + 1 for a base worktree and + 5 for a verifier.

## Rules

- Never push to the base branch or another task's branch.
- Never force-push without a lease, and lease-push (`git push --force-with-lease`) only your own branch.
- When you finish, stop only the servers you started and remove throwaway worktrees with `git worktree remove <path>`.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
