// Migration v51. Frozen: a shipped migration never changes. Migration 52 rebuilds the two ticket tables
// (see below), and the separate new-database schema uses `BOARD_TICKET_LATEST_SCHEMA_SQL`.
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

// Migration 52 adds the type of a ticket: `type` is feature, bug or chore, or null for "not set yet", and
// `type_source` says who set it (detected, user or agent), null while it was never set. A user choice is
// never changed by detection. A `type_changed` event records each later change; SQLite cannot change a
// CHECK in place, so the migration rebuilds `board_ticket_events` for the new kind and `board_tickets` to
// keep the type beside the status. Every row keeps its values and its rowid, so the event order stays.
// Every existing ticket gets a null type.
function boardTicketsTableSql(name: string): string {
  return `
  CREATE TABLE ${name} (
    ticket_id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
    body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 20000),
    status TEXT NOT NULL CHECK(status IN ('backlog', 'queued', 'running', 'needs_review', 'done')),
    type TEXT CHECK(type IS NULL OR type IN ('feature', 'bug', 'chore')),
    type_source TEXT CHECK(type_source IS NULL OR type_source IN ('detected', 'user', 'agent')),
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
  );`;
}

function boardTicketEventsTableSql(name: string): string {
  return `
  CREATE TABLE ${name} (
    event_id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES board_tickets(ticket_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('created', 'moved', 'assigned', 'comment', 'progress', 'type_changed')),
    actor TEXT NOT NULL CHECK(actor IN ('user', 'agent', 'sync')),
    from_status TEXT,
    to_status TEXT,
    text TEXT CHECK(text IS NULL OR length(text) <= 4000),
    created_at TEXT NOT NULL
  );`;
}

const V52_BOARD_TICKET_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS board_tickets_status ON board_tickets(status, sort_order);
  CREATE INDEX IF NOT EXISTS board_tickets_task ON board_tickets(task_id);
  CREATE UNIQUE INDEX IF NOT EXISTS board_tickets_external
    ON board_tickets(external_provider, external_key) WHERE external_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS board_ticket_events_ticket ON board_ticket_events(ticket_id, created_at);
`;

const V51_TICKET_COLUMNS = `ticket_id, title, body, status, agent_id, sort_order, task_id, thread_id, team_job_id,
    team_role_id, external_provider, external_key, external_url, progress, error, status_changed_at, created_at,
    updated_at`;
const V51_EVENT_COLUMNS = "event_id, ticket_id, kind, actor, from_status, to_status, text, created_at";

/** Migration 52. It runs with foreign keys off, inside the migration's transaction. */
export const V52_BOARD_TICKET_TYPE_MIGRATION_SQL = `
  ${boardTicketsTableSql("board_tickets_v52")}
  INSERT INTO board_tickets_v52 (rowid, ${V51_TICKET_COLUMNS}, type, type_source)
    SELECT rowid, ${V51_TICKET_COLUMNS}, NULL, NULL FROM board_tickets;
  ${boardTicketEventsTableSql("board_ticket_events_v52")}
  INSERT INTO board_ticket_events_v52 (rowid, ${V51_EVENT_COLUMNS})
    SELECT rowid, ${V51_EVENT_COLUMNS} FROM board_ticket_events;
  DROP TABLE board_ticket_events;
  DROP TABLE board_tickets;
  ALTER TABLE board_tickets_v52 RENAME TO board_tickets;
  ALTER TABLE board_ticket_events_v52 RENAME TO board_ticket_events;
  ${V52_BOARD_TICKET_INDEXES_SQL}
`;

const V51_BOARD_SETTINGS_SQL = BOARD_TICKET_SCHEMA_SQL.slice(
  BOARD_TICKET_SCHEMA_SQL.indexOf("  CREATE TABLE IF NOT EXISTS board_settings"),
);

/** The board tables of a new database, as migration 52 leaves them. */
export const BOARD_TICKET_LATEST_SCHEMA_SQL = `
  ${boardTicketsTableSql("IF NOT EXISTS board_tickets")}
  ${boardTicketEventsTableSql("IF NOT EXISTS board_ticket_events")}
  ${V52_BOARD_TICKET_INDEXES_SQL}
${V51_BOARD_SETTINGS_SQL}`;
