# Agent work threads and side chat

Design for epic #96: one agent works on many tasks at the same time, each in its own work thread,
and the user asks questions in a side chat while a turn runs. Terms follow
[the glossary](../glossary.md).

## Summary of decisions

| Question | Decision |
| --- | --- |
| What is a work thread? | An **agent task** (`projection_agent_tasks`, `AgentTask`). The epic's "work thread" is the architecture name; the UI keeps the released word "task" (EN and AR catalogs, phone, `agent-tasks-v1`). |
| Main thread | `agent.threadId` stays the agent's main thread ("own chat"). It has no task row, so every released database works with no change. |
| Workspace rule (A2) | One git worktree per work thread when the agent workspace is the top level of a git repository. Otherwise the work thread shares the workspace, as before. |
| Concurrency (A4) | The released per-agent `taskLimit` (1 to `AGENT_TASK_LIMIT_MAX`, default 2) and the server-wide `TurnSlots` limit. No new setting. |
| Pause and archive (A8) | Archive is the released close/reopen. Pause/resume is new: a paused work thread keeps its queue and starts no turn. |
| Side chat storage (B5) | Temporary. The host keeps nothing; the window keeps the exchanges until the pane closes. No table. |
| Memory across threads | Shared. Memories belong to the agent identity, so a memory that one work thread saves is in the prompt of every thread at its next turn. |
| Mobile and web (A10) | They show work threads through the released `agent-tasks-v1` capability. Pause, rename, delete and the worktree path are local to the desktop for now. |
| Team API (A9) | Released protocols v1-v3 and `agent-tasks-v1` do not change. A paused work thread shows to an `agent-tasks-v1` peer with the released hold `agent-busy`. |

## Identity and work threads

An agent has one identity: name, instructions, skills, memories, access, provider, model and
workspace. These stay on the agent (`projection_agents`, `agent_json`), and a work thread never
copies them. A work thread owns:

- its thread (`projection_threads`, conversation and history),
- its provider sessions (`projection_provider_sessions` rows of that thread),
- its queue lane (mailbox records with its `taskId`; `DrainScheduler` drains each lane),
- its browser tabs (released task behavior),
- its workspace folder: a git worktree, or the shared agent workspace,
- its pause state.

`ThreadLifecycle` already starts one provider session per thread, so two work threads of one agent
each resume their own session. A turn runs per lane, not per agent. The main thread lane does not
count toward the task limit.

The messaging-thread pattern (`projection_messaging_threads`, `MessagingLink`) is the model for one
agent with many execution threads. Agent tasks follow that pattern and were added in migration 38,
so this epic extends tasks instead of adding a second, parallel record.

## Work-thread record (migration 46)

`projection_agent_work_threads` holds what a task row does not:

| Column | Meaning |
| --- | --- |
| `task_id` | Primary key, references `projection_agent_tasks(task_id) ON DELETE CASCADE`. |
| `agent_id` | The agent, for lookups. |
| `workspace_mode` | `shared` or `worktree`. |
| `worktree_path` | Absolute path of the worktree, or null in `shared` mode. |
| `worktree_branch` | Branch of the worktree, or null in `shared` mode. |
| `paused_at` | Set while the work thread is paused. |
| `created_at`, `updated_at` | Timestamps. |

A task with no row is a `shared`, not paused work thread. This is the state of every task that a
released build made, so the migration only creates the table and copies no data. The latest schema
for new databases contains the same table.

## Workspace rule

When a user or the agent starts a work thread, `AgentWorkThreads` checks the agent workspace:

1. `git -C <workspace> rev-parse --show-toplevel` must return the workspace itself. A workspace
   inside a larger repository, or with no repository, uses `shared` mode.
2. The worktree goes to `<workspace>/.openbot/worktrees/<short id>` on a new branch
   `openbot/<short id>` from the current `HEAD`. The folder is inside the workspace, so the
   Workspace only sandbox and `workspaceWritableRoots` already allow it, and the provider can write
   the main `.git` folder.
3. `/.openbot/worktrees/` is added once to `.git/info/exclude`, so the main checkout does not show
   the worktrees as untracked files. OpenBot does not change `.gitignore`.
4. If a step fails, the work thread uses `shared` mode and the start guidance warns about shared
   files, as before. A failed worktree never stops the task.

`ThreadLifecycle` uses the worktree path as `cwd` for the sessions of that thread. The writable
roots stay the agent workspace and the shared root.

Reverse actions: archive (close) and pause keep the worktree. Delete removes the worktree only when
`git status --porcelain` is empty in it; otherwise the folder and its branch stay, and the user can
merge or remove them. Merging the results of two threads is out of scope.

## Turns, limit, pause

- Concurrency: at most `agentTaskLimit(agent)` work-thread turns of one agent run at the same time,
  next to the main thread. A provider with `concurrentTurns: false` runs one turn at a time.
- Pause: the drain holds every delivery of a paused lane with the reason `paused`. A turn that
  already runs continues to its end; Stop interrupts it. Resume clears `paused_at` and wakes the drain.
- Budget and Stop all: a work thread that reaches its budget, or the Stop all agents switch of this
  computer, holds its lane the same way (reasons `budget` and `stopped`). See
  [autonomy safety](autonomy-safety.md).
- Archive: close/reopen as released. A closed work thread takes no message.
- Rename: sets the task title.
- Delete: only a closed work thread. It removes the thread, its history and attachments, the task
  row and the work-thread row in one dispatch, after the caller releases the provider sessions.

## Approvals, sign-in cards, notifications

Prompts, approvals and takeover requests of a work-thread turn carry the thread id of that work
thread (released behavior). The renderer finds the task of that thread and shows its title on the
card ("From task: …", `prompt.workThread.from`). The notification title is "{agent}, task: {thread}"
(`notification.workThreadTitle`, the `workThread` argument of `notificationForAgentEvent`); main
finds the task only for a local event, and a channel title wins over a task. A click on that
notification opens the task in the side panel. The main thread shows no label.

## Sidebar and task panel

- `SidebarWorkThreads` (`@openbot/ui`) lists the open tasks of each agent whose task list loaded,
  under its row, with `AgentTaskMark` and `agentTaskStatus` (working, waiting for your approval,
  paused, done). It has a "New task" row and a context menu: rename, pause/resume, close.
- A sidebar row, or a notification, calls `requestOpenTask` in `agent-tasks-context`. The side panel
  of the agent's chat listens to `openRequest`, opens the task, and calls `finishOpenRequest`, so a
  later mount does not open it again.
- `AgentTaskPanel` adds pause/resume, rename (click the title), delete (closed task only), the
  branch line of a worktree task, and "Ask on the side". Each action is an optional prop, so the
  Tasks page and a joined server keep the released panel.

## Side chat

A side chat is the released side question (`AskSideQuestionInput`, `SideQuestionPanel`), attached
to one thread:

- It reads a read-only snapshot of the thread: the recent chat messages, the current plan, and the
  files that the thread changed. `AskSideQuestionInput.taskId` names a work thread; without it the
  side chat reads the main thread.
- It runs as a separate, tool-less generation with the agent's provider and model
  (`generateTextWithoutTools` on a profile client). It is not the thread's provider session, it has
  no write tools, and it never enters the mailbox. So it does not block, queue behind or steer the
  main turn.
- "Send to main thread" puts the text of an answer, or the draft, into the thread as a normal user
  message. When a turn runs, the message waits in the queue (or steers, when the agent's busy mode
  is "steer"), as any message does. This is the only path from the side chat into the task.
- The panel says that the side chat does not change the task.
- Storage: temporary (see the table). The request carries the earlier exchanges, as released.

The Team API `side-question-v1` codec does not carry `taskId`, and `route-side-question` builds its
input without it. A joined server answers about the main thread only, until a new capability adds it.

Implementation: `AgentService.askSideQuestion` reads the task with `readTask` (last 60 messages),
the newest plan message (`latestPlanText`), and `worktreeChangedFiles` (`git diff --stat HEAD` and
the new untracked files, at most 8,000 characters; null for a shared workspace or a git failure).
`sideQuestionPrompt` adds a `<task>` block. In the renderer, `openSideQuestion(text, taskId)`
attaches the side chat (the exchanges reset when the thread changes) and
`sendSideQuestionToThread` sends through `tasks.onSend`. "Send to main thread" shows only for a
task side chat.

## Mobile and web client

The phone and the web client read work threads through `agent-tasks-v1` and show them as tasks
(released). This epic does not change them. Pause, rename, delete and worktrees are desktop-only
until a new optional capability (`agent-work-threads-v1`) carries them.

## End-to-end checks

Both scripts drive the running dev app of the worktree with a real provider, as
`scripts/agent-tasks-e2e.ts` does, and need `--allow-mutations --agent=<id>` of an agent whose
provider runs turns at the same time:

- `scripts/agent-work-threads-e2e.ts`: two tasks in two threads run together and finish; each
  history holds only its own marker; two worktree tasks have two folders. Report:
  `.openbot-build/agent-work-threads-e2e/report.json`.
- `scripts/agent-side-chat-e2e.ts`: a side question with `taskId` answers while the task turn runs,
  the turn then completes, the question is not in the task history, and text sent to the main
  thread reaches the task. Report: `.openbot-build/agent-side-chat-e2e/report.json`.

## Risks

- Migration: the migration only creates a table, so released rows are not touched. Fixtures cover
  every released schema, failure, rollback and retry.
- File conflicts: worktrees separate the files of git workspaces. A non-git workspace still shares
  files; the start guidance warns the agent.
- Cost: the task limit bounds parallel turns per agent, and `TurnSlots` bounds the server.
- Memory: shared by design; a thread that needs private notes keeps them in its own conversation.
