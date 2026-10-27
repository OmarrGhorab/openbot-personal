---
name: raven-stack-quality
description: "Score one pull request's code quality out of 10 at an exact commit, as a reviewer who did not write it: audit the full diff and its callers, prove or drop each suspected defect, and deduct only for proven findings (high -3, medium -2, low -1). Use alongside verification before calling a PR done."
---

# Score quality out of 10

This is the "is it good code" gate, separate from "does it work" (`$raven-stack-verify`) and from the author. Output: a score and proven findings. Never push, fix or merge.

Inputs: the PR, the **exact commit**, the brief and criteria, the plan, the verifier's report if any.

## 1. Look at exactly what is scored

```bash
git fetch origin "pull/<pr>/head" <base>
tmp="$(mktemp -d)/quality-<pr>"
git worktree add --detach "$tmp" <sha>
cd "$tmp" && test "$(git rev-parse HEAD)" = "<sha>"
```

Read `git diff <base-sha>...<sha>` in full, then read changed files whole, grep the callers of anything whose signature or behaviour changed, and read the tests that cover it. If the head has moved past `<sha>`, score `<sha>` and say so.

## 2. What counts

Only **proven** findings deduct: a `file:line` plus a repro, a failing or targeted test, a traced caller, or a quoted contract (brief, docs, types) it violates. A suspicion you can't prove is a note: say what would confirm it, deduct nothing.

Hunt in:

- **Correctness:** criterion not really implemented, logic errors, null, empty and error paths, races, broken callers, nearby regressions.
- **Security and data:** committed secrets, auth or permission holes, unsafe input handling (injection, mass assignment, path traversal), data loss or corruption.
- **Tests:** changed behaviour with no test, tests asserting mocks, weakened, skipped or `.only` tests, tests loosened to pass.
- **Scope and structure:** changes outside the brief, churn, duplication of something that exists, dead code, debug leftovers, abstractions the codebase doesn't use.
- **Craft:** loosened types (`any`, `mixed`, `interface{}`, suppressions), disabled checks, swallowed errors, naming or structure that fights the codebase. Branch names or commits that leak secrets or customer data are high.

## 3. Score

Start at 10. Deduct per proven finding:

| Severity | Means | Deduct |
| --- | --- | --- |
| high | breaks a criterion, regression, security or data risk, committed secret | −3 |
| medium | a real defect or maintenance cost that will bite soon | −2 |
| low | minor defect, weak test, small pattern violation | −1 |

Any high finding caps the score at 6. An unmet criterion caps it at 5. Never below 0. **10/10 means zero proven actionable findings** and is the only passing score. Don't soften a severity to reach a nicer number, and don't invent findings to look thorough: an honest 10/10 on a clean diff is a normal result. Running a targeted test to prove or drop a suspicion carries more weight than reading.

## 4. Report

Post with `gh pr comment <pr> --body-file quality.md`:

```markdown
## Quality evaluation: <score>/10
Commit: `<sha>` · evaluator did not author this change

| # | Severity | Deduct | Finding | Proof |
|---|---|---|---|---|
| 1 | medium | −2 | <what is wrong> | `file:line` — <repro, test or caller trace> |

**Notes (no deduction):** <suspicions and what would confirm them, or none>
**What I checked:** diff (<n> files), callers of <…>, tests <…>, commands <…>
**Verdict:** PERFECT (10/10) / NOT PERFECT (<score>/10)
```

Make each finding fixable without a follow-up question: what, why it matters, where, and how to prove it fixed.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
