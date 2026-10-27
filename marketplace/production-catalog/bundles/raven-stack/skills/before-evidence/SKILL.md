---
name: raven-stack-before-evidence
description: "Capture BEFORE evidence on the base commit, before changing code: a bug reproduction, screenshots at a fixed viewport, command or API output, or the test results a refactor must keep. Use right after planning, or when a PR needs a before-and-after comparison."
---

# Capture BEFORE

Capture on the base, before you change code. Keep the files in `<evidence>/before/` (default `.artifacts/<id>/before/`, kept out of commits unless the project wants them committed).

## What to capture

| Change | Before evidence |
| --- | --- |
| Bug fix | Reproduce the defect: record it, or write the failing test and save its output to `before/test.txt`. No reproduction means you don't understand the bug yet, so keep digging. If it truly won't reproduce, say so in the report. |
| UI change | Screenshots of each affected screen at a fixed viewport: 1440x900 by default, plus 375x812 if mobile matters. Same data, same signed-in user, same starting state you will use after. |
| API change | Request and response pairs (method, path, status, body with secrets masked) plus any data side effect, in `before/api.txt`. |
| CLI or job | The command, its exit code and its output, in `before/output.txt`. |
| Performance | The measured numbers with the command used and the number of runs. |
| Refactor | The full test results and any output that must stay identical. |

## Capture the base without disturbing your branch

```bash
git worktree add --detach ../<repo>-<id>-base <base-commit>
cd ../<repo>-<id>-base     # install here, run on your port + 1
```

Remove it afterwards with `git worktree remove ../<repo>-<id>-base`.

## Tools, first that works

1. The project's own verification skill or script, if it has one.
2. A browser automation tool you have (Playwright, a browser-driving skill, the harness's browser): open the page, set the viewport, screenshot.
3. A screen recorder driven while you use the app. Annotate each step as setup, test start, assertion.
4. For non-UI work, plain shell output saved with `tee`.

## Rules

- Use local or disposable environments with seeded test accounts. Never production, a shared database or real customer data.
- Never let a token, password, key, cookie, webhook secret or personal data appear in a screenshot, recording or log. Mask it, or record that one was issued without its value.
- One screen recorder at a time if the desktop is shared. If another agent holds it, record only your own browser instead of waiting.
- Open your own captures and check that each one shows what you'll claim.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
