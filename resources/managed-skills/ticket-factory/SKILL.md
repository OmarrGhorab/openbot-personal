---
name: ticket-factory
description: Work one GitHub ticket from take to merge. Use when a brief says $ticket-factory, when you take a ticket from Tickets or chat, or when you are asked to review another agent's ticket.
---

# Ticket factory

One ticket, one branch, one pull request. Tickets come from GitHub issues only. Do not read or write Jira.

Report each phase on the ticket with `update_ticket` (`phase`). Set `type` when the ticket's type is wrong (bug, feature, chore). When a step fails, set `error` to the step and the reason, and stop.

## Phases

1. **take** - Read the issue, its comments and the linked issues. Say in one line what done looks like.
2. **triage** - Find the code that the ticket touches. Name the files. For a large change, write a short plan first (the pstack `architect` skill, when installed).
3. **reproduce** (bugs only) - Make the bug happen before you change anything. Attach the before evidence with `attach_ticket_evidence`: a failing test, a log, or a screenshot of the real app window. No reproduction, no fix: report what you tried.
4. **implement** - Work on the branch `ticket/<N>-<slug>` in the ticket's worktree. Use the pstack `bug-fix`, `feature` or `tdd` skill when installed. Add or change tests with the code.
5. **verify** - Run the typecheck and the tests that cover the change. Attach the after evidence: the test output, and for a UI change, real window screenshots in English and in Arabic (right to left). Check that Arabic text and the right-to-left layout read correctly.
6. **review** - Ask a second agent with `request_ticket_review`. The reviewer reads the diff and the evidence and answers with `submit_ticket_verdict` (PASS or FAIL with the reasons). On FAIL, fix and ask again. After three FAILs, stop and report.
7. **merge** - Open the pull request with `open_ticket_pull_request`. Its text says `Fixes #<N>` and lists the evidence. Merge only when the setting allows it and the verdict is PASS.
8. **report** - End with a short report: what changed, the tests and their result, the evidence, and what you are not sure about.

## Rules for UI changes

- Screenshots come from the real app window, never from a mock or a story.
- Monochrome. No blue, no coloured icon tiles, no emoji. The primary button is solid white with dark text. Red only for errors.
- No visible queue or internal counters in the UI.
- Every new string has an English and an Arabic translation.

## As the reviewer

Check that the change does what the ticket asks, that the tests cover it, and that the evidence is real. Give FAIL with concrete reasons, or PASS. Do not fix the work yourself.
