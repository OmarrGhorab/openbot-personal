# Autonomy safety: graded permissions, budgets, audit log, Stop all agents

This page describes issue #126 (autonomy 7). It covers what is built, where each part lives, and what
is not built yet. Terms follow [the glossary](../glossary.md).

## Summary of decisions

| Question | Decision |
| --- | --- |
| Where is the check? | In the main process, in `AttentionRegistry`, before a provider command, file change or permission request is answered. The provider waits for that answer. |
| What is a risk level? | `low`, `medium` or `high`. The classifier is pure (`src/backend/autonomy/action-risk.ts`). |
| Does a low-risk action ask? | No. Never, for any agent that is not Workspace only. |
| Default for medium and high | Both ask. A person can turn either one off per agent. |
| Where are the rules stored? | `openbot-autonomy-v1.json` in the profile folder. It is a settings file, like the approval preference. |
| Where are budgets stored? | Limits in the same settings file. Usage in SQLite (`autonomy_turn_usage`, migration 48). |
| Where is the audit log? | SQLite (`autonomy_audit_log`, migration 48). Secrets are masked before the write. |
| What does Stop all agents do? | Holds every lane of every agent and stops each running turn. Queued messages stay queued. The stop is stored, so it holds after a restart. |
| Are Workspace only agents affected? | They keep the released card for every approval. The rule does not widen their sandbox. |

## Risk levels

| Level | Actions (examples) | Rule codes (audit detail) |
| --- | --- | --- |
| Low | Read files or git state; run tests; make a branch; push to an `openbot/*` branch | `read`, `test.run`, `git.branch.create`, `git.push.own` |
| Medium | Open, comment on or review a pull request; install dependencies; change files; commit; push to another branch | `gh.pr.write`, `deps.install`, `file.change`, `git.commit`, `git.push.other` |
| High | Merge; deploy; delete data or files; run migrations; change secrets; push to `main`, `master` or another default branch; force push; run an unknown command | `gh.merge`, `deploy.infra`, `delete`, `data.migrate`, `secrets.change`, `git.push.default`, `git.push.forced`, `command.unknown` |

Other rules:

- A command with command substitution (`$(…)`, backticks) is high.
- `sudo` is high.
- A pipe into a shell is high.
- `sh -c "…"` is classified by its text, up to two levels deep.
- A file write with `>` is at least medium.
- A permission request is high. A file change is medium.
- A command that the classifier does not know is high. Unknown is never low.

## Rules per agent

Each agent has two switches in **Settings, Safety and limits**: medium risk asks and high risk asks.
Both default to on. Turning one off lets actions of that level run without a card. The change applies
to the next request. A request that already waits is answered at once.

The Full access setting still works as before. Full access answers every request, so a rule does not
change it.

## Budgets

Each agent can set limits for each work thread (`perTask`) and for the agent per local day
(`perDay`). Each limit can be tokens, minutes or estimated cost in USD. An empty field is no limit.

- A finished turn writes one row: its work thread (empty for the agent's own chat), its wall time,
  its tokens and its estimated cost. The cost is null when the model has no price.
- Before a lane starts a turn, the drain checks the limits. A reached limit holds the lane with the
  reason `budget`.
- A turn that runs is checked every 2 seconds. A turn that reaches a limit is stopped. Its queue
  waits behind the budget hold.
- A stop writes one `budget.stopped` audit row.
- A daily limit holds the agent until the local day changes or the person raises the limit.

**Guarantee.** A limit is checked before each turn, and each running turn is checked every 2 seconds.
The usage that a provider reports in that interval can pass a limit by up to one check. A stop cannot
undo usage that a provider has already reported.

**Cost.** A cost limit counts only turns with a known price. A model with no price adds no cost.

## Audit log

Each row holds: time, action, agent, thread, work thread, risk level, result, target and detail.

| Action | When |
| --- | --- |
| `approval.auto` | A rule or Full access answered a request without a card. |
| `approval.asked` | A request waits for the person. |
| `approval.accepted` / `approval.declined` | The person answered a request. |
| `budget.stopped` | A turn stopped at a limit. |
| `stop-all.started` / `stop-all.resumed` | Stop all agents was turned on or off. |
| `rules.changed` / `budgets.changed` | A rule or a budget was saved. |

**Scope.** Built-in tool approvals (for example, MCP server changes and hosted-site changes) are
logged when they ask and when they are answered by a rule. Hosted-site changes that run without a card
are not logged yet. A tool that a provider runs without asking is not logged, because OpenBot does not
see it.

**Redaction.** Every `target` and `detail` passes through `redactAuditText`
(`src/backend/autonomy/audit-redaction.ts`). It masks the forms that `redactText` masks, and also a
secret that follows a flag such as `--token`. A row keeps at most 400 characters, on one line.

**Reading the log.** **Settings, Safety and limits** lists the rows, newest first, with filters for
agent, risk and action. The list pages 50 rows at a time. The log has no retention limit yet.

## Stop all agents

The **Stop all agents** switch is in the sidebar header. It reads the stop from main when the sidebar
opens. When it is on, the switch shows **Resume agents**.

- Main writes the stop to the settings file first. Then `AgentService.stopAll` interrupts each running
  turn. Queued messages keep their place.
- `DrainScheduler` checks the stop before any lane starts a turn.
- Resume clears the stop and schedules the drain of every agent.

The stop covers the agents of this computer only. A joined team server has its own stop.

## Where the code is

| Part | File |
| --- | --- |
| Risk classifier | `src/backend/autonomy/action-risk.ts` |
| Policy interface and defaults | `src/backend/autonomy/autonomy-policy.ts` |
| Controller: gate answers, drain holds, budget watcher, turn ledger | `src/backend/autonomy/autonomy-controller.ts` |
| Audit store and redaction | `src/backend/autonomy/autonomy-audit-store.ts`, `audit-redaction.ts` |
| Usage store | `src/backend/autonomy/autonomy-usage-store.ts` |
| Schema, migration 48 | `src/backend/autonomy/autonomy-schema.ts`, `openbot-database-schema.ts` |
| Approval gate | `src/backend/agent/attention-registry.ts` (`surfaceApproval`, `surfaceLegacyApproval`, `respondToApproval`) |
| Drain hold | `src/backend/agent/drain-scheduler.ts` (`#heldBy`) |
| Turn hooks | `src/backend/agent/turn-lifecycle.ts` (`turnStarted`, `turnEnded`) |
| Settings file | `src/main/autonomy-preferences.ts` |
| Admin, IPC | `src/main/autonomy-admin.ts`, `src/main/ipc/autonomy-handlers.ts`, group `autonomy` in `packages/contracts/src/ipc-endpoints.ts` |
| Settings tab and sidebar switch | `src/renderer/src/features/autonomy/`, `packages/ui/src/features/sidebar/SidebarTopbar.tsx` |

## Work threads: isolation (task 7.5)

Each work thread runs in its own git worktree when the agent workspace is a git repository
(`agent-tasks/agent-worktrees.ts`, migration 46). See [agent work threads](agent-work-threads.md).

## Not built yet

- **Level 2, container per work thread (7.6).** Not built. Work threads use a worktree, not a container.
- **Level 3, remote runner (7.7).** Not built. This needs the team server and a second computer.
- **Per-agent isolation setting (7.8).** Not built. Only the worktree mode exists, so there is no choice.
- **Undo (7.14).** Not built. Revert a commit, close a pull request, remove an MCP server and restore a
  setting each need their own reverse action. The rule and budget rows record the new values only.
- **Audit log retention.** No row is pruned yet.
- **Hosted-site changes without a card** are not in the audit log yet (see Audit log).
