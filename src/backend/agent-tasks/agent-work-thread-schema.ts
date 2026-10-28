// Shared by migration v46 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// A work thread is an agent task (`projection_agent_tasks`) seen as one of the parallel execution
// threads of its agent. This table keeps what the task row does not: the workspace folder of the work
// thread and its pause state. A task with no row here is a `shared`, not paused work thread, which is
// what every task before v46 was. The agent's main thread is `agent.threadId` and has no row.
//
// `workspace_mode`: `worktree` when the work thread runs in its own git worktree, `shared` when it
// runs in the agent's workspace. `worktree_path` and `worktree_branch` are set only in `worktree`
// mode. `paused_at` is set while the person pauses the work thread: its queue keeps its messages and
// starts no turn. Deleting the task deletes the row.
export const AGENT_WORK_THREAD_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_agent_work_threads (
    task_id TEXT PRIMARY KEY REFERENCES projection_agent_tasks(task_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    workspace_mode TEXT NOT NULL CHECK(workspace_mode IN ('shared', 'worktree')),
    worktree_path TEXT,
    worktree_branch TEXT,
    paused_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK((workspace_mode = 'worktree') = (worktree_path IS NOT NULL AND worktree_branch IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS agent_work_threads_agent ON projection_agent_work_threads(agent_id);
`;
