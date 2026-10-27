---
name: raven-stack-plan
description: "Turn a task into acceptance criteria, a check that proves each one, a difficulty rating and a file-level plan with data shapes, steps, tests and traps, before writing code. Use for any task that is more than a one-line change, or when a plan must be precise enough for another agent to follow."
---

# Plan before code

Weaker implementers fail on ambiguity, not syntax: they guess the data shape, touch the wrong file, invent an API, or stop at "it compiles". The plan removes those guesses.

## 1. Read before planning

Read the code the task will touch and its callers. Find the existing pattern to copy (a similar component, endpoint, job, test) and note it with `file:line`. Check open PRs for the same files (`gh pr list`, then `gh pr diff <n> --name-only`). Run the app or command if you need to see current behaviour.

## 2. Criteria into checks

Restate the request as acceptance criteria that can pass or fail. For each one, write how you will prove it: which screen, which actions and what must be visible, or which command or request and its expected output. These checks become the recording script and the PR checklist.

## 3. Shape the work

Split a task that is really several changes. Merge tasks that edit the same code. Flag anything that needs a human decision (product choice, credentials, irreversible migration) instead of planning around a guess.

## 4. Write the plan

```markdown
# Plan: <id> — <title>
Difficulty: small | medium | hard   (why, in one line)

## Approach
<3-6 sentences: what changes and why this way. Name the pattern copied, with file:line.>

## Files
- edit `path/to/file`: <what changes>
- add `path/to/test`: <what it tests>
- do NOT touch: <files that look related but must stay>

## Data shapes and interfaces
<exact types, signatures, props, request and response, DB columns. Real code, not prose.>

## Steps
1. <small, ordered, each ends in something checkable>

## Tests
<which tests, what each asserts in user-visible terms, the command to run them>

## Acceptance checks
<each criterion and exactly how to prove it>

## Traps
<likely mistakes here, e.g. "the list is paginated server-side; don't slice on the client", "use the existing toast helper, don't add a library">
```

If you can't write a step precisely, you don't understand the task yet. Read more code, or mark it needs-human with the open question.

## 5. Rate difficulty

- **small:** 1 to 3 files, an existing pattern to copy, no new dependency, no concurrency, auth, payments or migrations.
- **medium:** several files or a new component or endpoint, with a clear plan.
- **hard:** cross-cutting design, concurrency, security, data migration, performance, or a bug without a confirmed root cause. Give these to the strongest worker and two verifiers.

Changes touching auth, payments, data or infrastructure are risky at any size: mark them so verification gets a second opinion.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
