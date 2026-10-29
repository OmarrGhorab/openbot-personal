// Shared by migration v51 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// `board_tickets`: one row for each ticket on the Tickets board. `status` is the board column.
// `agent_id` is the assigned agent, or null for an unassigned ticket. `sort_order` orders the tickets
// of one column. `task_id` and `thread_id` link the work thread and its conversation; `team_job_id` and
// `team_role_id` link a Raven Stack team job and role. The links have no foreign key: deleting a work
// thread or a job keeps the ticket. `external_*` is the linked issue of a ticket system, all null or all
// set. `progress` is the live progress line, and `error` is the last failure line.
//
// `board_ticket_events`: the activity of a ticket, oldest first: creation, moves, comments, assignment
// and progress. The stepper reads the last move into each column. Deleting a ticket deletes its events.
//
// `board_settings`: one row (`board_id` = 'main') for the board's sync target. No row means no sync.
//
// The old Tasks page had no rows of its own, so nothing is copied: the board starts empty.
export const BOARD_TICKET_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS board_tickets (
    ticket_id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
    body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 20000),
    status TEXT NOT NULL CHECK(status IN ('backlog', 'queued', 'running', 'needs_review', 'done')),
    agent_id TEXT,
    sort_order REAL NOT NULL,
    task_id TEXT,
    thread_id TEXT,
    team_job_id TEXT,
    team_role_id TEXT,
    external_provider TEXT CHECK(external_provider IS NULL OR external_provider IN ('github', 'jira', 'linear')),
    external_key TEXT CHECK(external_key IS NULL OR length(external_key) BETWEEN 1 AND 300),
    external_url TEXT CHECK(external_url IS NULL OR length(external_url) BETWEEN 1 AND 2000),
    progress TEXT CHECK(progress IS NULL OR length(progress) <= 500),
    error TEXT CHECK(error IS NULL OR length(error) <= 2000),
    status_changed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK((external_provider IS NULL) = (external_key IS NULL) AND (external_key IS NULL) = (external_url IS NULL))
  );
  CREATE INDEX IF NOT EXISTS board_tickets_status ON board_tickets(status, sort_order);
  CREATE INDEX IF NOT EXISTS board_tickets_task ON board_tickets(task_id);
  CREATE UNIQUE INDEX IF NOT EXISTS board_tickets_external
    ON board_tickets(external_provider, external_key) WHERE external_key IS NOT NULL;
  CREATE TABLE IF NOT EXISTS board_ticket_events (
    event_id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES board_tickets(ticket_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('created', 'moved', 'assigned', 'comment', 'progress')),
    actor TEXT NOT NULL CHECK(actor IN ('user', 'agent', 'sync')),
    from_status TEXT,
    to_status TEXT,
    text TEXT CHECK(text IS NULL OR length(text) <= 4000),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS board_ticket_events_ticket ON board_ticket_events(ticket_id, created_at);
  CREATE TABLE IF NOT EXISTS board_settings (
    board_id TEXT PRIMARY KEY CHECK(board_id = 'main'),
    sync_provider TEXT CHECK(sync_provider IS NULL OR sync_provider IN ('github', 'jira', 'linear')),
    sync_project TEXT CHECK(sync_project IS NULL OR length(sync_project) BETWEEN 1 AND 300),
    last_synced_at TEXT,
    updated_at TEXT NOT NULL
  );
`;
