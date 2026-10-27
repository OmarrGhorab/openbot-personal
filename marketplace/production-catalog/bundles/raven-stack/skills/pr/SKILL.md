---
name: raven-stack-pr
description: "Open a draft pull request with a title and body a reviewer can understand from a notification: summary, what changed, stack profile, criteria with evidence, before and after table, recording, checks on the head commit, risks. Use when the gates pass and AFTER evidence exists, or to rewrite a vague PR."
---

# Open the draft PR

Push your branch and open the PR as a draft against the base:

```bash
git push -u origin <branch>
gh pr create --draft --base <base> --title "<title>" --body-file pr-body.md
```

## Title

`<Category>: <what changed, user-facing first>`, then ` (<id>)` only when the task has one.

- Good: `Bug: export button on settings downloads the CSV again (ABC-7)`, `Feat: users can change their timezone`.
- Never a bare ID, a slug, or filler like "fix stuff". One line of scope, not a changelog.

## Body

Link the issue on the first line when there is one (`Fixes <issue>`). Write it plainly (`$raven-stack-unslop`).

```markdown
## Summary
<2-4 lines: what the user can do or see now that they couldn't, and why.>

## What changed
<files or areas touched, approach in one line.>

## Stack profile
<detected stack per package and the gate commands used>

## Acceptance criteria
- [x] <criterion> — <evidence link or test name>
- [ ] <criterion not met> — <why>

## Before / After
| Before | After |
|---|---|
| <capture> | <capture> |

## Recording
<link> — <what it shows, in the order of the assertions>

## Checks
`<command>` → <result>   (one line per gate, on commit <short sha>)

## Risks and follow-ups
<what a reviewer should look at; out-of-scope issues spotted>
```

## Commits

`<category>(<area>): <plain summary>`, same categories as the branch. Branch, commits and title must never contain secrets, customer data or internal-only details.

## Rules

- Never merge, close or retarget a PR yourself unless the user explicitly grants it.
- Mark it ready for review (`gh pr ready <pr>`) only after verification and quality pass on the current head.
- Update the body whenever the head changes: checks line, evidence, criteria.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
