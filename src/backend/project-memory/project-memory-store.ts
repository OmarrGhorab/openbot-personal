import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isProjectMemory,
  PROJECT_MEMORY_KINDS,
  PROJECT_MEMORY_LIMIT,
  type ProjectMemory,
  type ProjectMemoryKind,
  type ProjectMemoryUndo,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Schema } from "effect";
import { databaseRow, databaseRows, requiredStringColumn } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/** An expected refusal, with text the user can read. Anything else is a failure of the database. */
export class ProjectMemoryError extends Schema.TaggedError<ProjectMemoryError>()("ProjectMemoryError", {
  message: Schema.String,
}) {}

export interface SaveProjectMemoryInput {
  projectKey: string;
  /** Null edits nothing: the entry is new. */
  memoryId?: string | null;
  kind: ProjectMemoryKind;
  text: string;
  /** The agent that saves the entry, or null for the OpenBot user. */
  agentId: string | null;
}

export interface SavedProjectMemory {
  memory: ProjectMemory;
  /** False when the save found the same entry, so nothing was written. */
  changed: boolean;
}

export interface ProjectMemorySearchResult {
  memories: ProjectMemory[];
  hasMore: boolean;
}

const COLUMNS = `memory_id, kind, text, saved_by_agent_id, updated_by_agent_id, created_at, updated_at`;

/** A copy of an entry before its last change, kept in the undo slot. */
interface UndoSlot {
  action: ProjectMemoryUndo["action"];
  memoryId: string;
  before: ProjectMemory | null;
  changedByAgentId: string | null;
  changedAt: string;
}

/**
 * Owns the saved facts of each project folder, the one-change undo slot, and their redaction. It
 * reads `.connection` at each use and never imports the facade's transaction helpers, because a
 * cached handle outlives `close()`. It writes no events: the table is the record.
 */
export class ProjectMemoryStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  list(projectKey: string): ProjectMemory[] {
    return databaseRows(
      this.#database.connection
        .prepare(`SELECT ${COLUMNS} FROM project_memories WHERE project_key = ? ORDER BY updated_at DESC, memory_id`)
        .all(projectKey),
    ).map(memoryFromRow);
  }

  get(projectKey: string, memoryId: string): ProjectMemory | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(`SELECT ${COLUMNS} FROM project_memories WHERE project_key = ? AND memory_id = ?`)
        .get(projectKey, memoryId),
    );
    return row ? memoryFromRow(row) : null;
  }

  count(projectKey: string): number {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT COUNT(*) AS count FROM project_memories WHERE project_key = ?")
        .get(projectKey),
    );
    return Number(row?.count ?? 0);
  }

  /** The change that `revert` would undo, or null. */
  lastChange(projectKey: string): ProjectMemoryUndo | null {
    const slot = this.#undoSlot(projectKey);
    if (!slot) return null;
    return {
      action: slot.action,
      memoryId: slot.memoryId,
      changedByAgentId: slot.changedByAgentId,
      changedAt: slot.changedAt,
    };
  }

  /**
   * Adds an entry, or edits one by `memoryId`. The text is redacted first, and the redacted text is
   * what is saved. Two entries of one project never share a normalized text: a save that finds one
   * returns it, or refuses an edit that would make a second.
   */
  save(input: SaveProjectMemoryInput): SavedProjectMemory {
    if (!isOneOf(PROJECT_MEMORY_KINDS, input.kind)) throw new ProjectMemoryError({ message: memoryFailed() });
    const text = prepareText(input.text);
    const normalized = normalizeProjectMemoryText(text);
    return this.#transaction(() => {
      const duplicate = this.#byNormalizedText(input.projectKey, normalized);
      const now = new Date().toISOString();
      if (!input.memoryId) {
        if (duplicate) return { memory: duplicate, changed: false };
        if (this.count(input.projectKey) >= PROJECT_MEMORY_LIMIT)
          throw new ProjectMemoryError({
            message: sourceText("error.backend.projectMemoryLimit", { limit: PROJECT_MEMORY_LIMIT }),
          });
        const memory: ProjectMemory = {
          id: randomUUID(),
          kind: input.kind,
          text,
          savedByAgentId: input.agentId,
          updatedByAgentId: input.agentId,
          createdAt: now,
          updatedAt: now,
        };
        this.#insert(input.projectKey, memory, normalized);
        this.#recordChange(input.projectKey, "create", memory.id, null, input.agentId, now);
        return { memory, changed: true };
      }
      const current = this.get(input.projectKey, input.memoryId);
      if (!current) throw new ProjectMemoryError({ message: sourceText("error.backend.memoryGone") });
      if (duplicate && duplicate.id !== current.id)
        throw new ProjectMemoryError({ message: sourceText("error.backend.projectMemoryDuplicate") });
      if (current.kind === input.kind && current.text === text) return { memory: current, changed: false };
      const updated: ProjectMemory = {
        ...current,
        kind: input.kind,
        text,
        updatedByAgentId: input.agentId,
        updatedAt: now,
      };
      this.#database.connection
        .prepare(
          `UPDATE project_memories SET kind = ?, text = ?, normalized_text = ?, updated_by_agent_id = ?, updated_at = ?
           WHERE project_key = ? AND memory_id = ?`,
        )
        .run(updated.kind, text, normalized, input.agentId, now, input.projectKey, current.id);
      this.#recordChange(input.projectKey, "update", current.id, current, input.agentId, now);
      return { memory: updated, changed: true };
    });
  }

  delete(projectKey: string, memoryId: string, agentId: string | null): void {
    this.#transaction(() => {
      const current = this.get(projectKey, memoryId);
      if (!current) throw new ProjectMemoryError({ message: sourceText("error.backend.memoryGone") });
      this.#recordChange(projectKey, "delete", memoryId, current, agentId, new Date().toISOString());
      this.#database.connection
        .prepare("DELETE FROM project_memories WHERE project_key = ? AND memory_id = ?")
        .run(projectKey, memoryId);
    });
  }

  /**
   * Restores the entry as it was before the last change, then clears the slot. Returns false when
   * there is no change to undo.
   */
  revert(projectKey: string): boolean {
    return this.#transaction(() => {
      const slot = this.#undoSlot(projectKey);
      if (!slot) return false;
      if (slot.action === "create") {
        this.#database.connection
          .prepare("DELETE FROM project_memories WHERE project_key = ? AND memory_id = ?")
          .run(projectKey, slot.memoryId);
      } else if (slot.before) {
        const duplicate = this.#byNormalizedText(projectKey, normalizeProjectMemoryText(slot.before.text));
        if (duplicate && duplicate.id !== slot.before.id)
          throw new ProjectMemoryError({ message: sourceText("error.backend.projectMemoryDuplicate") });
        this.#restore(projectKey, slot.before);
      }
      this.#database.connection.prepare("DELETE FROM project_memory_undo WHERE project_key = ?").run(projectKey);
      return true;
    });
  }

  /**
   * The entries that match any word of the query, best match first, then the newest. Matching is by
   * word, not by query operators, so a word such as `OR` is only a word.
   */
  search(projectKey: string, query: string, limit: number): ProjectMemorySearchResult {
    const terms = [...new Set(normalizeProjectMemoryText(query).match(/[\p{L}\p{N}\p{M}]+/gu) ?? [])];
    if (query.length > 256 || terms.length === 0 || !Number.isInteger(limit) || limit < 1 || limit > 10)
      throw new ProjectMemoryError({ message: sourceText("error.backend.memorySearchQuery") });
    const scored = this.list(projectKey)
      .map((memory) => {
        const haystack = normalizeProjectMemoryText(memory.text);
        return { memory, score: terms.filter((term) => haystack.includes(term)).length };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    return {
      memories: scored.slice(0, limit).map((entry) => entry.memory),
      hasMore: scored.length > limit,
    };
  }

  /** Runs `operation` in one transaction, or inside the caller's when one is already open. */
  #transaction<T>(operation: () => T): T {
    const db = this.#database.connection;
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      if (ownsTransaction) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  #byNormalizedText(projectKey: string, normalized: string): ProjectMemory | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(`SELECT ${COLUMNS} FROM project_memories WHERE project_key = ? AND normalized_text = ?`)
        .get(projectKey, normalized),
    );
    return row ? memoryFromRow(row) : null;
  }

  #insert(projectKey: string, memory: ProjectMemory, normalized: string): void {
    this.#database.connection
      .prepare(
        `INSERT INTO project_memories (memory_id, project_key, kind, text, normalized_text,
           saved_by_agent_id, updated_by_agent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        memory.id,
        projectKey,
        memory.kind,
        memory.text,
        normalized,
        memory.savedByAgentId,
        memory.updatedByAgentId,
        memory.createdAt,
        memory.updatedAt,
      );
  }

  /** Puts an entry back exactly as it was. Used by undo of an edit and of a delete. */
  #restore(projectKey: string, memory: ProjectMemory): void {
    this.#database.connection
      .prepare(
        `INSERT INTO project_memories (memory_id, project_key, kind, text, normalized_text,
           saved_by_agent_id, updated_by_agent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(memory_id) DO UPDATE SET
           kind = excluded.kind, text = excluded.text, normalized_text = excluded.normalized_text,
           saved_by_agent_id = excluded.saved_by_agent_id, updated_by_agent_id = excluded.updated_by_agent_id,
           created_at = excluded.created_at, updated_at = excluded.updated_at`,
      )
      .run(
        memory.id,
        projectKey,
        memory.kind,
        memory.text,
        normalizeProjectMemoryText(memory.text),
        memory.savedByAgentId,
        memory.updatedByAgentId,
        memory.createdAt,
        memory.updatedAt,
      );
  }

  #recordChange(
    projectKey: string,
    action: ProjectMemoryUndo["action"],
    memoryId: string,
    before: ProjectMemory | null,
    agentId: string | null,
    changedAt: string,
  ): void {
    this.#database.connection
      .prepare(
        `INSERT INTO project_memory_undo (project_key, action, memory_id, before_json, changed_by_agent_id, changed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_key) DO UPDATE SET
           action = excluded.action, memory_id = excluded.memory_id, before_json = excluded.before_json,
           changed_by_agent_id = excluded.changed_by_agent_id, changed_at = excluded.changed_at`,
      )
      .run(projectKey, action, memoryId, before ? JSON.stringify(before) : null, agentId, changedAt);
  }

  #undoSlot(projectKey: string): UndoSlot | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          "SELECT action, memory_id, before_json, changed_by_agent_id, changed_at FROM project_memory_undo WHERE project_key = ?",
        )
        .get(projectKey),
    );
    if (!row) return null;
    const action = requiredStringColumn(row, "action");
    if (!isOneOf(["create", "update", "delete"] as const, action)) throw new Error("Invalid project memory change.");
    const beforeJson = row.before_json;
    let before: ProjectMemory | null = null;
    if (beforeJson !== null) {
      if (!isString(beforeJson)) throw new Error("Invalid project memory change.");
      const parsed = JSON.parse(beforeJson);
      if (!isProjectMemory(parsed)) throw new Error("Invalid project memory change.");
      before = parsed;
    }
    return {
      action,
      memoryId: requiredStringColumn(row, "memory_id"),
      before,
      changedByAgentId: optionalString(row, "changed_by_agent_id"),
      changedAt: requiredStringColumn(row, "changed_at"),
    };
  }
}

/** Trims, redacts, then checks the length: a redacted secret can change the length. */
function prepareText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ProjectMemoryError({ message: sourceText("error.backend.memoryTextRequired") });
  if (trimmed.length > INPUT_LIMITS.agentMemoryText)
    throw new ProjectMemoryError({ message: sourceText("error.backend.memoryTextTooLong") });
  const redacted = redactText(trimmed).trim();
  if (!redacted) throw new ProjectMemoryError({ message: sourceText("error.backend.memoryTextRequired") });
  if (redacted.length > INPUT_LIMITS.agentMemoryText)
    throw new ProjectMemoryError({ message: sourceText("error.backend.memoryTextTooLong") });
  return redacted;
}

/** Case, spacing and ends do not make a second entry. */
function normalizeProjectMemoryText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function memoryFromRow(row: DynamicRecord): ProjectMemory {
  const kind = requiredStringColumn(row, "kind");
  if (!isOneOf(PROJECT_MEMORY_KINDS, kind)) throw new Error("Invalid project memory kind.");
  return {
    id: requiredStringColumn(row, "memory_id"),
    kind,
    text: requiredStringColumn(row, "text"),
    savedByAgentId: optionalString(row, "saved_by_agent_id"),
    updatedByAgentId: optionalString(row, "updated_by_agent_id"),
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
}

function optionalString(row: DynamicRecord, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (!isString(value)) throw new Error("Invalid project memory column.");
  return value;
}

function memoryFailed(): string {
  return sourceText("error.backend.memoryOperationFailed");
}
