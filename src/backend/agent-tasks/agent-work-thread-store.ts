import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { databaseRow, databaseRows, optionalStringColumn, requiredStringColumn } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

export const AGENT_WORK_THREAD_WORKSPACE_MODES = ["shared", "worktree"] as const;
export type AgentWorkThreadWorkspaceMode = (typeof AGENT_WORK_THREAD_WORKSPACE_MODES)[number];

/** The workspace folder of one work thread. */
export type AgentWorkThreadWorkspace =
  | { mode: "shared" }
  | {
      mode: "worktree";
      /** The absolute path of the git worktree. */
      path: string;
      branch: string;
    };

/** What a work thread keeps beside its task row. A task with no record is shared and not paused. */
export interface AgentWorkThreadRecord {
  taskId: string;
  agentId: string;
  workspace: AgentWorkThreadWorkspace;
  /** Set while the person pauses the work thread. */
  pausedAt: string | null;
}

const SHARED: AgentWorkThreadWorkspace = { mode: "shared" };

/**
 * Owns `projection_agent_work_threads` (migration 46). It never imports the database facade's callers.
 *
 * The row is a projection of local settings, not of the event log: it holds no title and no message,
 * and deleting the task deletes it.
 */
export class AgentWorkThreadStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  /** The record of the task, or the default of a task that has none. */
  get(taskId: string, agentId: string): AgentWorkThreadRecord {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM projection_agent_work_threads WHERE task_id = ?").get(taskId),
    );
    return row ? decodeWorkThread(row) : { taskId, agentId, workspace: SHARED, pausedAt: null };
  }

  /** The paused work threads of this agent. */
  pausedTaskIds(agentId: string): string[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          "SELECT task_id FROM projection_agent_work_threads WHERE agent_id = ? AND paused_at IS NOT NULL ORDER BY task_id",
        )
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "task_id"));
  }

  setWorkspace(taskId: string, agentId: string, workspace: AgentWorkThreadWorkspace): void {
    const now = new Date().toISOString();
    const path = workspace.mode === "worktree" ? workspace.path : null;
    const branch = workspace.mode === "worktree" ? workspace.branch : null;
    this.#database.connection
      .prepare(
        `INSERT INTO projection_agent_work_threads
           (task_id, agent_id, workspace_mode, worktree_path, worktree_branch, paused_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           workspace_mode = excluded.workspace_mode,
           worktree_path = excluded.worktree_path,
           worktree_branch = excluded.worktree_branch,
           updated_at = excluded.updated_at`,
      )
      .run(taskId, agentId, workspace.mode, path, branch, now, now);
  }

  /** Pauses the work thread, or resumes it with null. */
  setPaused(taskId: string, agentId: string, pausedAt: string | null): void {
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO projection_agent_work_threads
           (task_id, agent_id, workspace_mode, worktree_path, worktree_branch, paused_at, created_at, updated_at)
         VALUES (?, ?, 'shared', NULL, NULL, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET paused_at = excluded.paused_at, updated_at = excluded.updated_at`,
      )
      .run(taskId, agentId, pausedAt, now, now);
  }
}

function decodeWorkThread(row: DynamicRecord): AgentWorkThreadRecord {
  const mode = requiredStringColumn(row, "workspace_mode");
  if (!isOneOf(AGENT_WORK_THREAD_WORKSPACE_MODES, mode)) throw new Error(`Unknown workspace mode: ${mode}`);
  const path = optionalStringColumn(row, "worktree_path");
  const branch = optionalStringColumn(row, "worktree_branch");
  return {
    taskId: requiredStringColumn(row, "task_id"),
    agentId: requiredStringColumn(row, "agent_id"),
    workspace: mode === "worktree" && path && branch ? { mode, path, branch } : SHARED,
    pausedAt: optionalStringColumn(row, "paused_at"),
  };
}
