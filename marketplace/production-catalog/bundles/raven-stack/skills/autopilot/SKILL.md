---
name: raven-stack-autopilot
description: "Run the whole Raven Stack flow on one coding task, from brief to a verified, 10/10, CI-green pull request, in any language or framework. Use when you want the task done end to end without supervision, or say 'autopilot this'."
---

# Raven Stack autopilot

One task, one branch, one proven pull request. The flow is the same in every repository; only the commands change, and `$raven-stack-detect` finds those first. Nobody answers questions mid-task, so make reasonable calls and write them down. Claim only what your evidence shows.

Three rules carry the rest:

1. **The brief is the product.** Turn the request into written acceptance criteria before any code. A vague brief fails quietly.
2. **The author never approves their own code.** A PR is done only when an independent pass has proven the exact head commit. Green CI, a bot review or the author's own report is never a verdict.
3. **Done is one commit.** Verifier PASS, before and after evidence, quality 10/10 and green CI, all on the same head. Any new push invalidates the old verdict and the old score.

## The flow

| Step | Skill | Output |
| --- | --- | --- |
| 0 | read `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `.cursor/rules`, `.claude`, `.agents`, `docs/` | project rules, which beat this skill |
| 1 | `$raven-stack-detect` | stack profile and command map per package |
| 2 | `$raven-stack-worktree` | own worktree, branch `<category>/<id>-<slug>`, base commit, deps installed |
| 3 | `$raven-stack-plan` | criteria turned into checks, difficulty, file-level plan, traps |
| 4 | `$raven-stack-before-evidence` | `<evidence>/before/` on the base |
| 5 | `$raven-stack-build` | small commits, red-then-green for bugs |
| 6 | `$raven-stack-gates` | install, format, lint, typecheck, test, build all run on the committed head |
| 7 | `$raven-stack-after-evidence` | `<evidence>/after/` plus one recording with an assertion per criterion |
| 8 | `$raven-stack-pr` | draft PR with the body template, written plainly (`$raven-stack-unslop`) |
| 9 | `$raven-stack-ci` | every check green |
| 10 | `$raven-stack-verify` | PASS, PASS+NOTES, FAIL or BLOCKED on the exact head |
| 11 | `$raven-stack-quality` | score out of 10 on the same head |
| 12 | `$raven-stack-fix-round` | repeat 5 to 11 until every lane agrees on one commit |

Steps 10 and 11 may run in parallel on the same commit. Use separate agents for them when the harness can spawn them. When it can't, do each pass in a fresh detached worktree as if someone else wrote the code.

## Team roles in OpenBot

When OpenBot starts this task as a team, your brief begins with "You are the <Role> of a Raven Stack team". Then:

- Do only the steps of your role, from the table above. Run only the skills your brief lists.
- Only the Builder commits and pushes. Read-only roles change no file.
- End your final message with one `RAVEN-REPORT:` line, as the brief says. OpenBot reads the verdict and the commit from that line. A message without it is asked once more, then the role is blocked.
- A verifier reviews only the commit that the brief names. A new commit makes the old verdicts void.
- After a FAIL, the Builder gets the findings. Fix them in the fix round, push a new commit and report it.

Without such a brief, use the one-agent flow above.

## Several tasks at once

When you coordinate more than one task, own the queue and the verdicts, never the code. Every branch has exactly one writer.

- Write the standing orders once in `orders.md`: repo, base branch (default `main`), task list, the finish condition as checks that can pass or fail ("all 4 PRs have PASS and 10/10 on their head and green CI"; a duration is not a finish condition), grants (merge: no by default; public evidence upload: no by default), and the project commands from `$raven-stack-detect`.
- Tasks that touch the same files are not independent. Merge them, or order them and start the dependent one from the parent's branch. Check open PRs for overlap first.
- Give each worker its own port and worktree. Verifiers use the worker's port plus 5.
- Treat completions as events: read the result, check it against git and the PR (head commit, evidence links), update the queue, start the next step.
- Replace an agent that shows no new commits, PR updates or report past the stuck time, from its brief plus the current branch.
- After two FAIL rounds by the same worker, move the task to a stronger worker with everything the old one had. At the round cap (default 3 on the same finding), stop that task and report it as not done, with its real score.
- Only these reach the human: irreversible actions, merges without a grant, product choices no experiment can settle, missing credentials, round caps. Never escalate rebases, flaky CI, review-bot noise or formatting.

## Final report

```
CODE-READY | VERIFIED | BLOCKED
pr: <link>
branch: <category>/<id>-<slug>
head: <full commit>   base: <commit>
stack: <profile per package>
gates: <command → result, one per line>
criteria: <met>/<total>; unmet: <list or none>
verdict: <PASS | PASS+NOTES | FAIL | BLOCKED>   quality: <score>/10
evidence: <before, after and recording links>
decisions: <calls the brief didn't decide>
follow-ups: <out-of-scope issues, or none>
```

For several tasks, add one table row per task: task, difficulty, built by, verified by, PR, verdict and commit, quality, rounds, evidence. Then the finish condition and whether it is met.

Never merge, close or retarget a PR unless the user explicitly grants it. Without a grant, stop at verified and ready for review.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
