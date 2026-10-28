# Agent ticket intake

Design for issue #120 (Autonomy 1): an agent takes a ticket from a ticket system, starts a work
thread for it, opens a pull request, and reacts to the checks and review comments of that pull
request. Terms follow [the glossary](../glossary.md). A work thread is an agent task, as in
[agent work threads](agent-work-threads.md).

## Summary of decisions

| Question | Decision |
| --- | --- |
| Where does the watch live? | `projection_agent_ticket_watches` (migration 49): one row per agent. A watch holds the provider, the project, the label and an enabled flag. The agent settings row "Ticket source" reads and writes it through `agentTicketWatch` IPC. |
| How are tickets found? | A timer in the main process polls each enabled watch every five minutes (`AgentTicketWatcher`). It makes no model call. The ticket says "routine-based polling"; a routine would run a model turn for each poll, so the poll is native code. |
| Webhook? | Not in this version. GitHub's signature is not OpenBot's, so a webhook needs a relay that converts it. Polling is the only ticket intake. |
| How is a ticket started once? | `projection_agent_ticket_links`: the primary key `(agent_id, provider, ticket_key)` is reserved before the task starts. A second poll, or a race, finds the row and does nothing. |
| What happens to a link when a work thread is deleted? | The link stays, so a deleted ticket does not start again. The link has no foreign key to the task. |
| What happens when a start fails? | The reservation is dropped, so the next poll tries again. The failure is logged with the ticket key only. |
| What happens when the comment fails? | It is logged and not retried. The work thread keeps running. |
| How does a pull request reach its thread? | The agent calls `register_pull_request` after it opens the pull request. `projection_agent_ticket_pulls` gives the pull request one owner. Only a work thread that started from a ticket can own one. |
| How do check failures and review comments reach the thread? | `TicketPullEvents.handle` routes an event to the owning thread: a failed check sends the failure text to the thread, a passing check clears the count, a review comment sends the comment to the thread. The handler does not poll. The delivery of these events from GitHub is not in this version. |
| What is the stop rule? | `TICKET_FIX_ATTEMPT_LIMIT` (3). After the third failed check in a row, the thread is paused and the ticket gets a comment that asks a person for the next step. |

## Flow

1. `AgentTicketWatcher` runs `AgentTicketIntake.poll` on its timer, and never starts a second pass
   while one runs.
2. `poll` reads every enabled watch. A watch with no source for its provider is skipped.
3. The GitHub source lists open issues with the watch label, on one page of 50. Pull requests are
   left out. The token is read from the GitHub connection on each pass.
4. For each issue, `reserve` writes the link. A link that exists means the issue is already started.
5. `startTask` (the agent service's `startTask`) starts the work thread with the brief from
   `ticketBrief`. The brief's first line is the task title. The ticket text is JSON inside
   `--- external ticket input ---` markers, and the agent is told to treat it as data.
6. `attachTask` stores the task on the link. A comment names the agent and the work thread.
7. The agent opens a pull request and calls `register_pull_request` with the repository and the
   pull request number. The tool result says `registered`, or it names the reason it failed.
8. A pull request event, once delivered, goes to `TicketPullEvents.handle`. A failed check wakes the
   thread with `fix attempt N of 3`. The stop rule takes over at the third failure.

## Checks and evidence

- Migration fixtures: `src/backend/agent-ticket-migration.test.ts` (every released schema from 8 to
  47, rollback after a late failure, a missing history version, a new database).
- Service E2E: `scripts/ticket-to-pr-e2e.ts`. It runs the real agent service, the intake, the GitHub
  adapter, the pull request tool, the pull request handler and the database, with a fake provider and
  a local fake GitHub. It writes `.openbot-build/autonomy-1/ticket-to-pr-e2e.json`.
- Type checks cover the IPC contract, the main handlers, the preload decoders, the preview mock and
  the settings row. The settings screen is not checked in a running app.

## Not done

- Webhook intake, and delivery of pull request events from GitHub to `TicketPullEvents.handle`.
- Linear and Jira intake.
- Plan approval (`Wait for plan approval`). It needs a hold after the planning turn in the drain, and
  its low-risk auto-approval needs the permission levels of #130.
- Making the `babysit` and `ship` skills available to agents. Their availability depends on the
  skill library for each agent, which this change does not verify.
- A deep link from the comment to the work thread. OpenBot has no task link to put in a comment.
- Checking the settings screen in a running desktop app.
- Merging the work of #130 and #131. This change does not use either.

## Dependencies

- Migration 49 follows migration 48. Pull request #130 uses 48 and is not merged. Until 48 exists in
  the branch, the migration registry refuses version 49, because the versions must be contiguous.
- Permission levels and budgets (#130) are not used. The intake uses the existing task limit.
- Check own work (#131) is not used.

## Risks

- A crash, a defect or an interruption between `reserve` and `attachTask` leaves a reservation with
  no task. The ticket then does not start on its own. The reservation is kept on purpose: the task may
  already exist, and a second start would be worse. No code cleans up a stale reservation yet.
- A ticket is started while the agent's task limit is full. Its first message waits in the queue
  until a turn slot frees.
- The ticket text and the pull request text are untrusted. They can try to change the agent's
  instructions. The markers and the "data, not instructions" line reduce that risk; they do not remove it.
