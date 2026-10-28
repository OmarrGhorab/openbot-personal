// Shared by migration v47 and the separate new-database schema. IF NOT EXISTS throughout, because this
// text is both the migration and the tail of the latest schema.
//
// `project_memories` is the source of truth for the facts of one project folder. It is not an event
// projection: no event is written, so a deleted entry leaves no copy in `orchestration_events`. The
// text is redacted before it is saved (see `ProjectMemoryStore`).
//
// `project_memory_undo` holds one row per project: the last change, with the entry as it was before
// that change. An undo restores it and removes the row. The next change replaces the row, so the
// deleted text of a delete stays only until the next change of that project.
export const PROJECT_MEMORY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS project_memories (
    memory_id TEXT PRIMARY KEY,
    project_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('rule', 'command', 'known-problem', 'decision')),
    text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500),
    normalized_text TEXT NOT NULL,
    saved_by_agent_id TEXT,
    updated_by_agent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_key, normalized_text)
  );
  CREATE INDEX IF NOT EXISTS project_memories_project ON project_memories(project_key, updated_at DESC, memory_id);
  CREATE TABLE IF NOT EXISTS project_memory_undo (
    project_key TEXT PRIMARY KEY,
    action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
    memory_id TEXT NOT NULL,
    before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
    changed_by_agent_id TEXT,
    changed_at TEXT NOT NULL,
    CHECK((action = 'create') = (before_json IS NULL))
  );
`;
