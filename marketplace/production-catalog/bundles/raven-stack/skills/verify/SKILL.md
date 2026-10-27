---
name: raven-stack-verify
description: "Independently verify one pull request at an exact commit, as someone who did not write it: rerun the gates, audit the diff against the brief, drive the app live while recording, check the author's evidence, and return PASS, PASS+NOTES, FAIL or BLOCKED with proof. Use before calling any PR done."
---

# Verify independently

You are the gate between "the author says it works" and "it works". Trust no claim until you have checked it. Never push to the PR branch and never fix the code. Your output is a verdict with evidence. The author never verifies their own change; if no other agent is available, do this pass in a fresh worktree as if the code were someone else's.

Inputs: the PR, the **exact commit** to verify, the brief and criteria, the author's report.

## 1. Check out exactly that commit

```bash
git fetch origin "pull/<pr>/head" <base>
tmp="$(mktemp -d)/verify-<pr>"
git worktree add --detach "$tmp" <sha>
cd "$tmp" && test "$(git rev-parse HEAD)" = "<sha>"
```

If the PR head has moved past `<sha>`, still verify `<sha>` and mention the newer head. Install inside this worktree. Use the author's port + 5 and confirm it answers to your process.

## 2. Rerun the gates

Run every gate from `$raven-stack-gates` yourself and paste command and result line. A gate reported green that fails here is a finding.

## 3. Audit the diff against the brief

Read `git diff <base-sha>...<sha>` in full.

- Every criterion is implemented, not just mentioned.
- Nothing out of scope: unrelated rewrites, formatting churn, debug leftovers.
- Title `<Category>: <what changed>`, a Summary that says what the user can do now, branch `<category>/<id>-<slug>`. A placeholder title or empty body is a low finding.
- Tests assert behaviour a user would notice and fail without the fix. No tests that only check mocks.
- No skipped, disabled, loosened, `.only` or `.skip` checks. No committed secrets. No swallowed errors.
- Obvious defects: null and empty cases, error paths, races, edge cases, broken callers of changed functions (grep for them).

## 4. Drive the app live

Required for any runtime change; skip it only for docs or comments, and say so.

- Record while you use the app, one assertion per criterion plus at least one nearby path the change could break.
- Bug fix: reproduce the bug on the base commit in a second detached worktree and confirm it is gone at `<sha>`. If it doesn't reproduce on the base, the fix is unproven.
- Non-UI change: run the real command or request and compare with the base.
- Save captures to `<evidence>/verify-r<round>/`.

## 5. Check the author's evidence

Do the before and after captures and the recording show the claimed behaviour at this commit, at the same viewport and starting state? An after that doesn't match what you saw live is a finding. So is a before that doesn't show the bug.

## 6. Verdict

- **PASS**: every criterion proven live, gates green, no defects.
- **PASS+NOTES**: proven and shippable; notes are non-blocking polish or follow-ups.
- **FAIL**: at least one proven defect: unmet criterion, regression, failing gate, scope violation, or evidence that misrepresents the change.
- **BLOCKED**: a required lane could not run (app won't start, missing credentials, broken environment). Never counts as a pass.

Only proven findings count toward FAIL. "Might be a problem" goes in notes with what would confirm it. List every proven finding, not just the first. Post it with `gh pr comment <pr> --body-file verdict.md`:

```markdown
## Verification: <VERDICT>
Commit: `<sha>` · round <n> · verifier did not author this change

| Criterion | Result | Evidence |
|---|---|---|
| <criterion> | pass / fail / untested | <link> |

**Gates:** `<command>` → <result>

**Findings** (blocking)
1. <high|medium|low> — <what is wrong> — `file:line` — repro: <steps> — evidence: <link>

**Notes** (non-blocking)
- …

**Author evidence check:** <matches / doesn't, and why>
**Recording:** <link>
```

For changes touching auth, payments, data or infrastructure, or rated hard, get a second independent verifier and require both to pass. Finish by removing your worktrees and stopping servers you started. Keep the evidence.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
