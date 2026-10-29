// Shared by migration v49 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// `projection_agent_ticket_watches`: the ticket source of one agent (migration 49). An agent has at
// most one watch. `provider` is the ticket system; `project` names the project (for GitHub, the
// `owner/repo` of the repository); `label` is the filter: only tickets that carry it start a work
// thread. `enabled` is 0 while the person pauses the watch. Deleting the agent leaves the row unused.
//
// `projection_agent_ticket_links`: one row for each ticket that the agent has started. The primary
// key makes a second start of the same ticket impossible, even when two polls race. `task_id` is the
// work thread (`projection_agent_tasks`), or null while the start is in progress. The row has no
// foreign key to the task: deleting a work thread keeps the link, so a deleted ticket does not start
// again on the next poll.
//
// `projection_agent_ticket_pulls`: the pull request that a work thread owns. The primary key gives one
// owner to a pull request. `failed_fixes` counts CI failures since the last passing check; the stop rule
// reads it. Like the links, the row has no foreign key to the task.
export const AGENT_TICKET_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_agent_ticket_watches (
    agent_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(provider IN ('github', 'linear', 'jira')),
    project TEXT NOT NULL CHECK(length(project) BETWEEN 1 AND 300),
    label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projection_agent_ticket_links (
    agent_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK(provider IN ('github', 'linear', 'jira')),
    ticket_key TEXT NOT NULL CHECK(length(ticket_key) BETWEEN 1 AND 300),
    task_id TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(agent_id, provider, ticket_key)
  );
  CREATE INDEX IF NOT EXISTS agent_ticket_links_task ON projection_agent_ticket_links(task_id);
  CREATE TABLE IF NOT EXISTS projection_agent_ticket_pulls (
    provider TEXT NOT NULL CHECK(provider IN ('github', 'linear', 'jira')),
    project TEXT NOT NULL CHECK(length(project) BETWEEN 1 AND 300),
    pull_number INTEGER NOT NULL CHECK(pull_number > 0),
    agent_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    ticket_key TEXT NOT NULL CHECK(length(ticket_key) BETWEEN 1 AND 300),
    failed_fixes INTEGER NOT NULL DEFAULT 0 CHECK(failed_fixes >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(provider, project, pull_number)
  );
  CREATE INDEX IF NOT EXISTS agent_ticket_pulls_task ON projection_agent_ticket_pulls(task_id);
`;
