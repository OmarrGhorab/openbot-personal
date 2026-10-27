---
name: raven-stack-fix-round
description: "Fix verifier or quality findings on the same branch: reproduce each one, show it failing, fix every instance of the pattern, refresh evidence, rerun the gates, and re-verify and re-score the new head. Use after a FAIL verdict, a score below 10, or a CHANGES design review."
---

# Fix round

Continue the existing branch and worktree. Increase the round number.

## Steps

1. **Reproduce each finding** on your current head. If you can't, reply with how you tried and keep it as a disagreement. Don't fix it blind.
2. **Red first.** Show the finding failing (a test or a capture), then fix it. When one finding is an instance of a pattern, fix every instance in the diff.
3. Commit each fix as `<category>(<area>): <plain summary>`.
4. Rerun every gate (`$raven-stack-gates`).
5. Refresh the affected AFTER evidence under `<evidence>/r<round>/after/` (`$raven-stack-after-evidence`).
6. Push (normal push; lease-push only after a rebase of your own branch), update the PR body's checks, criteria and evidence.
7. Report again with the new head and one line per finding: fixed (with evidence) or disputed (with the reason).
8. Re-run `$raven-stack-verify` and `$raven-stack-quality` on the new head. The old verdict and score no longer count.

## Limits

- A rebase, conflict fix or tiny follow-up still needs a verdict at the new head. If `git patch-id` of the change is identical at both commits, the old verdict may carry over; a different patch needs a new one.
- After two failed rounds by the same worker, hand the task to a stronger one with every finding and response so far. If findings show the plan was wrong, revise the plan first.
- Stop after 3 attempts on the same finding, or when a finding needs a human decision. Report the task as not done with its real score. Never lower the bar or skip verification to finish.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
