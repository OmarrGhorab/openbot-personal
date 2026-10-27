---
name: raven-stack-after-evidence
description: "Capture AFTER evidence on your branch that mirrors every BEFORE capture, then record the flow once with one assertion per acceptance criterion, and check each frame shows the claim. Use after the gates pass, and after each fix round."
---

# Capture AFTER and record the flow

Keep files in `<evidence>/after/`, and in `<evidence>/r<round>/after/` for fix rounds.

## 1. Mirror every BEFORE

Repeat each capture from `$raven-stack-before-evidence` on your head commit, with the same viewport, data, user and starting state, so each pair compares only your change.

## 2. Record the flow once

Start a recording, then drive the app yourself through every criterion. The recording is the test being performed live; a video of nothing happening is not evidence.

- Annotate as you go: a setup note (where you start), a test-start note per criterion in "it should ..." form, and an assertion with passed, failed or untested after each check.
- Work at a watchable pace. Let the UI settle after each action.
- Cover one nearby path the change could break: an empty state, an error state, the page next door, a second user role.
- Tool order: the project's verification skill; the harness's browser preview or recording tools; a screen recorder with annotations; headless Playwright with video and screenshots when there is no display.
- Non-UI change: run the real command or request and save the output next to the BEFORE output. A diff of the two is often the clearest evidence.

## 3. Check your own evidence

Open every screenshot and look at a frame at each assertion. Each one must show what you claim. Evidence that shows nothing useful does not count, and a mismatch between your claim and the frame is a defect to fix before the PR.

## 4. Publish

Default to private evidence: commit it under the repo's artifacts path on your branch, or attach it to the PR as the project allows. Upload to a public host only when the standing orders allow public evidence.

## Rules

- Local or disposable environments only. No production, shared databases or real customer data.
- No tokens, passwords, keys, cookies, webhook secrets or personal data in any frame or log. Mask them before saving.
- One screen recorder at a time if the desktop is shared.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
