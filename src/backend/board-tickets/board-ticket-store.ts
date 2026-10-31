import { randomUUID } from "node:crypto";
import {
  BOARD_TICKET_ACTORS,
  BOARD_TICKET_EVENT_KINDS,
  BOARD_TICKET_EVENT_LIMIT,
  BOARD_TICKET_EVIDENCE_KINDS,
  BOARD_TICKET_EVIDENCE_LIMIT,
  BOARD_TICKET_EVIDENCE_PHASES,
  BOARD_TICKET_LIST_LIMIT,
  BOARD_TICKET_PHASES,
  BOARD_TICKET_PROVIDERS,
  BOARD_TICKET_TYPE_SOURCES,
  type BoardTicket,
  type BoardTicketActor,
  type BoardTicketEvent,
  type BoardTicketEventKind,
  type BoardTicketEvidence,
  type BoardTicketExternal,
  type BoardTicketPhase,
  type BoardTicketProvider,
  type BoardTicketStatus,
  type BoardTicketType,
  type BoardTicketTypeSource,
  isBoardTicketStatus,
  isBoardTicketType,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/** The fields of a new ticket after validation. */
export interface NewBoardTicket {
  title: string;
  body: string;
  status: BoardTicketStatus;
  agentId: string | null;
  type?: BoardTicketType | null;
  typeSource?: BoardTicketTypeSource | null;
  taskId?: string | null;
  threadId?: string | null;
  teamJobId?: string | null;
  teamRoleId?: string | null;
  external?: BoardTicketExternal | null;
}

/** The fields that an update changes. An absent key keeps the stored value. */
export interface BoardTicketPatch {
  title?: string;
  body?: string;
  agentId?: string | null;
  /** The type and who set it. Present together. */
  type?: BoardTicketType | null;
  typeSource?: BoardTicketTypeSource | null;
  taskId?: string | null;
  threadId?: string | null;
  /** Set when an Autopilot job takes a ticket that is already on the board. */
  teamJobId?: string | null;
  external?: BoardTicketExternal | null;
  progress?: string | null;
  error?: string | null;
  /** The work phase that the agent reports (ticket 237). */
  phase?: BoardTicketPhase | null;
}

/** The sync target of the board. Null provider: the board does not sync. */
export interface BoardSettingsRecord {
  syncProvider: BoardTicketProvider | null;
  syncProject: string | null;
  lastSyncedAt: string | null;
}

/**
 * Owns `board_tickets`, `board_ticket_events` and `board_settings` (migrations 51 and 52). It never imports the
 * database facade's callers and opens no transaction of its own.
 *
 * Order is a REAL so a move between two tickets takes the midpoint and changes one row only.
 */
export class BoardTicketStore {
  readonly #database: OpenBotDatabase;
  readonly #now: () => string;

  constructor(database: OpenBotDatabase, now: () => string = () => new Date().toISOString()) {
    this.#database = database;
    this.#now = now;
  }

  list(): BoardTicket[] {
    const rows = databaseRows(
      this.#database.connection
        .prepare(`SELECT * FROM board_tickets ORDER BY sort_order, created_at LIMIT ${BOARD_TICKET_LIST_LIMIT}`)
        .all(),
    );
    const times = this.#statusTimes();
    return rows.map((row) => decodeTicket(row, times.get(requiredStringColumn(row, "ticket_id")) ?? {}));
  }

  get(ticketId: string): BoardTicket | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM board_tickets WHERE ticket_id = ?").get(ticketId),
    );
    if (!row) return null;
    return decodeTicket(row, this.#statusTimes(ticketId).get(ticketId) ?? {});
  }

  /** The ticket of a work thread, or null. */
  forTask(taskId: string): BoardTicket | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT ticket_id FROM board_tickets WHERE task_id = ? LIMIT 1").get(taskId),
    );
    return row ? this.get(requiredStringColumn(row, "ticket_id")) : null;
  }

  /** The open ticket that a chat thread took (#263), or null. A ticket with a work thread is never one. */
  forChatThread(threadId: string): BoardTicket | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          "SELECT ticket_id FROM board_tickets WHERE thread_id = ? AND task_id IS NULL AND status <> 'done' ORDER BY updated_at DESC LIMIT 1",
        )
        .get(threadId),
    );
    return row ? this.get(requiredStringColumn(row, "ticket_id")) : null;
  }

  /** The tickets of a Raven Stack team job: its own ticket and one for each role, oldest first. */
  forTeamJob(jobId: string): BoardTicket[] {
    const rows = databaseRows(
      this.#database.connection
        .prepare("SELECT ticket_id FROM board_tickets WHERE team_job_id = ? ORDER BY created_at, ticket_id")
        .all(jobId),
    );
    return rows.flatMap((row) => this.get(requiredStringColumn(row, "ticket_id")) ?? []);
  }

  /** The ticket that links an external issue, or null. */
  forExternal(provider: BoardTicketProvider, key: string): BoardTicket | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT ticket_id FROM board_tickets WHERE external_provider = ? AND external_key = ?")
        .get(provider, key),
    );
    return row ? this.get(requiredStringColumn(row, "ticket_id")) : null;
  }

  create(input: NewBoardTicket, actor: BoardTicketActor): BoardTicket {
    const ticketId = randomUUID();
    const now = this.#now();
    const external = input.external ?? null;
    this.#database.connection
      .prepare(
        `INSERT INTO board_tickets (ticket_id, title, body, status, type, type_source, agent_id, sort_order, task_id,
           thread_id, team_job_id, team_role_id, external_provider, external_key, external_url, progress, error,
           status_changed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      )
      .run(
        ticketId,
        input.title,
        input.body,
        input.status,
        input.type ?? null,
        input.type ? (input.typeSource ?? "detected") : (input.typeSource ?? null),
        input.agentId,
        this.#endOrder(input.status),
        input.taskId ?? null,
        input.threadId ?? null,
        input.teamJobId ?? null,
        input.teamRoleId ?? null,
        external?.provider ?? null,
        external?.key ?? null,
        external?.url ?? null,
        now,
        now,
        now,
      );
    this.addEvent(ticketId, "created", actor, { toStatus: input.status });
    const ticket = this.get(ticketId);
    if (!ticket) throw new Error("The board ticket was not stored.");
    return ticket;
  }

  /** Changes the fields in the patch. False when the ticket does not exist. */
  update(ticketId: string, patch: BoardTicketPatch): boolean {
    const columns: [string, string | null | undefined, boolean][] = [
      ["title", patch.title, "title" in patch],
      ["body", patch.body, "body" in patch],
      ["agent_id", patch.agentId, "agentId" in patch],
      ["type", patch.type, "type" in patch],
      ["type_source", patch.typeSource, "typeSource" in patch],
      ["task_id", patch.taskId, "taskId" in patch],
      ["thread_id", patch.threadId, "threadId" in patch],
      ["team_job_id", patch.teamJobId, "teamJobId" in patch],
      ["progress", patch.progress, "progress" in patch],
      ["error", patch.error, "error" in patch],
      ["phase", patch.phase, "phase" in patch],
    ];
    const sets: string[] = [];
    const values: (string | null)[] = [];
    for (const [column, value, present] of columns) {
      if (!present) continue;
      sets.push(`${column} = ?`);
      values.push(value ?? null);
    }
    if ("external" in patch) {
      sets.push("external_provider = ?", "external_key = ?", "external_url = ?");
      values.push(patch.external?.provider ?? null, patch.external?.key ?? null, patch.external?.url ?? null);
    }
    sets.push("updated_at = ?");
    values.push(this.#now());
    const result = this.#database.connection
      .prepare(`UPDATE board_tickets SET ${sets.join(", ")} WHERE ticket_id = ?`)
      .run(...values, ticketId);
    return result.changes === 1;
  }

  /**
   * Moves a ticket to a column: above `beforeTicketId` in that column, or to its end. Writes a `moved`
   * event when the column changes. Null when the ticket does not exist.
   */
  move(
    ticketId: string,
    status: BoardTicketStatus,
    beforeTicketId: string | null,
    actor: BoardTicketActor,
    note: string | null = null,
  ): BoardTicket | null {
    const current = this.get(ticketId);
    if (!current) return null;
    const order = this.#orderBefore(status, beforeTicketId, ticketId);
    const now = this.#now();
    const changed = current.status !== status;
    this.#database.connection
      .prepare(
        `UPDATE board_tickets SET status = ?, sort_order = ?, updated_at = ?,
           status_changed_at = CASE WHEN status = ? THEN status_changed_at ELSE ? END
         WHERE ticket_id = ?`,
      )
      .run(status, order, now, status, now, ticketId);
    if (changed) this.addEvent(ticketId, "moved", actor, { fromStatus: current.status, toStatus: status, text: note });
    return this.get(ticketId);
  }

  delete(ticketId: string): boolean {
    return (
      this.#database.connection.prepare("DELETE FROM board_tickets WHERE ticket_id = ?").run(ticketId).changes === 1
    );
  }

  addEvent(
    ticketId: string,
    kind: BoardTicketEventKind,
    actor: BoardTicketActor,
    detail: { fromStatus?: BoardTicketStatus | null; toStatus?: BoardTicketStatus | null; text?: string | null } = {},
  ): BoardTicketEvent {
    const event: BoardTicketEvent = {
      id: randomUUID(),
      ticketId,
      kind,
      actor,
      fromStatus: detail.fromStatus ?? null,
      toStatus: detail.toStatus ?? null,
      text: detail.text ?? null,
      createdAt: this.#now(),
    };
    this.#database.connection
      .prepare(
        `INSERT INTO board_ticket_events (event_id, ticket_id, kind, actor, from_status, to_status, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(event.id, ticketId, kind, actor, event.fromStatus, event.toStatus, event.text, event.createdAt);
    return event;
  }

  /** Adds one piece of evidence. `storedName` is the file in the ticket's evidence folder, or null for text. */
  addEvidence(
    input: Omit<BoardTicketEvidence, "id" | "createdAt"> & { storedName: string | null; id?: string },
  ): BoardTicketEvidence {
    const evidence: BoardTicketEvidence = {
      id: input.id ?? randomUUID(),
      ticketId: input.ticketId,
      kind: input.kind,
      phase: input.phase,
      actor: input.actor,
      caption: input.caption,
      fileName: input.fileName,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      text: input.text,
      createdAt: this.#now(),
    };
    this.#database.connection
      .prepare(
        `INSERT INTO board_ticket_evidence (evidence_id, ticket_id, kind, phase, actor, caption, file_name,
           stored_name, mime, size_bytes, text_content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evidence.id,
        evidence.ticketId,
        evidence.kind,
        evidence.phase,
        evidence.actor,
        evidence.caption,
        evidence.fileName,
        input.storedName,
        evidence.mime,
        evidence.sizeBytes,
        evidence.text,
        evidence.createdAt,
      );
    return evidence;
  }

  /** The evidence of a ticket, oldest first. */
  evidence(ticketId: string): BoardTicketEvidence[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT * FROM (SELECT rowid AS position, * FROM board_ticket_evidence WHERE ticket_id = ?
             ORDER BY created_at DESC, position DESC LIMIT ${BOARD_TICKET_EVIDENCE_LIMIT})
           ORDER BY created_at, position`,
        )
        .all(ticketId),
    ).map((row) => decodeEvidence(row).evidence);
  }

  /** How many pieces of evidence a ticket has. */
  evidenceCount(ticketId: string): number {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT COUNT(*) AS count FROM board_ticket_evidence WHERE ticket_id = ?")
        .get(ticketId),
    );
    return typeof row?.count === "number" ? row.count : 0;
  }

  /** One piece of evidence with the name of its stored file, or null. */
  evidenceById(evidenceId: string): { evidence: BoardTicketEvidence; storedName: string | null } | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM board_ticket_evidence WHERE evidence_id = ?").get(evidenceId),
    );
    return row ? decodeEvidence(row) : null;
  }

  /** The activity of a ticket, oldest first, at most `BOARD_TICKET_EVENT_LIMIT` of the newest. */
  events(ticketId: string): BoardTicketEvent[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT * FROM (SELECT rowid AS position, * FROM board_ticket_events WHERE ticket_id = ?
             ORDER BY created_at DESC, position DESC LIMIT ${BOARD_TICKET_EVENT_LIMIT})
           ORDER BY created_at, position`,
        )
        .all(ticketId),
    ).map(decodeEvent);
  }

  settings(): BoardSettingsRecord {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM board_settings WHERE board_id = 'main'").get(),
    );
    if (!row) return { syncProvider: null, syncProject: null, lastSyncedAt: null };
    const provider = optionalStringColumn(row, "sync_provider");
    if (provider !== null && !isOneOf(BOARD_TICKET_PROVIDERS, provider)) {
      throw new Error(`Unknown board sync provider: ${provider}`);
    }
    return {
      syncProvider: provider,
      syncProject: optionalStringColumn(row, "sync_project"),
      lastSyncedAt: optionalStringColumn(row, "last_synced_at"),
    };
  }

  setSettings(settings: BoardSettingsRecord): void {
    this.#database.connection
      .prepare(
        `INSERT INTO board_settings (board_id, sync_provider, sync_project, last_synced_at, updated_at)
         VALUES ('main', ?, ?, ?, ?)
         ON CONFLICT(board_id) DO UPDATE SET sync_provider = excluded.sync_provider,
           sync_project = excluded.sync_project, last_synced_at = excluded.last_synced_at,
           updated_at = excluded.updated_at`,
      )
      .run(settings.syncProvider, settings.syncProject, settings.lastSyncedAt, this.#now());
  }

  #endOrder(status: BoardTicketStatus): number {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT MAX(sort_order) AS high FROM board_tickets WHERE status = ?")
        .get(status),
    );
    const high = row?.high;
    return typeof high === "number" ? high + 1 : 1;
  }

  #orderBefore(status: BoardTicketStatus, beforeTicketId: string | null, movingId: string): number {
    if (!beforeTicketId || beforeTicketId === movingId) return this.#endOrder(status);
    const before = databaseRow(
      this.#database.connection
        .prepare("SELECT sort_order FROM board_tickets WHERE ticket_id = ? AND status = ?")
        .get(beforeTicketId, status),
    );
    if (!before) return this.#endOrder(status);
    const beforeOrder = requiredNumberColumn(before, "sort_order");
    const previous = databaseRow(
      this.#database.connection
        .prepare(
          "SELECT MAX(sort_order) AS low FROM board_tickets WHERE status = ? AND sort_order < ? AND ticket_id <> ?",
        )
        .get(status, beforeOrder, movingId),
    );
    const low = previous?.low;
    return typeof low === "number" ? (low + beforeOrder) / 2 : beforeOrder - 1;
  }

  /** The last time each ticket entered each column, from its `created` and `moved` events. */
  #statusTimes(ticketId?: string): Map<string, Partial<Record<BoardTicketStatus, string>>> {
    const filter = ticketId === undefined ? "" : "AND ticket_id = ?";
    const rows = databaseRows(
      this.#database.connection
        .prepare(
          `SELECT ticket_id, to_status, MAX(created_at) AS at FROM board_ticket_events
           WHERE kind IN ('created', 'moved') AND to_status IS NOT NULL ${filter}
           GROUP BY ticket_id, to_status`,
        )
        .all(...(ticketId === undefined ? [] : [ticketId])),
    );
    const times = new Map<string, Partial<Record<BoardTicketStatus, string>>>();
    for (const row of rows) {
      const id = requiredStringColumn(row, "ticket_id");
      const status = requiredStringColumn(row, "to_status");
      if (!isBoardTicketStatus(status)) continue;
      const entry = times.get(id) ?? {};
      entry[status] = requiredStringColumn(row, "at");
      times.set(id, entry);
    }
    return times;
  }
}

function decodeTicket(row: DynamicRecord, statusTimes: Partial<Record<BoardTicketStatus, string>>): BoardTicket {
  const status = requiredStringColumn(row, "status");
  if (!isBoardTicketStatus(status)) throw new Error(`Unknown board ticket status: ${status}`);
  const type = optionalStringColumn(row, "type");
  if (type !== null && !isBoardTicketType(type)) throw new Error(`Unknown board ticket type: ${type}`);
  const typeSource = optionalStringColumn(row, "type_source");
  if (typeSource !== null && !isOneOf(BOARD_TICKET_TYPE_SOURCES, typeSource)) {
    throw new Error(`Unknown board ticket type source: ${typeSource}`);
  }
  const phase = optionalStringColumn(row, "phase");
  if (phase !== null && !isOneOf(BOARD_TICKET_PHASES, phase)) throw new Error(`Unknown board ticket phase: ${phase}`);
  const provider = optionalStringColumn(row, "external_provider");
  const key = optionalStringColumn(row, "external_key");
  const url = optionalStringColumn(row, "external_url");
  let external: BoardTicketExternal | null = null;
  if (provider !== null && key !== null && url !== null) {
    if (!isOneOf(BOARD_TICKET_PROVIDERS, provider)) throw new Error(`Unknown ticket provider: ${provider}`);
    external = { provider, key, url };
  }
  return {
    id: requiredStringColumn(row, "ticket_id"),
    title: requiredStringColumn(row, "title"),
    body: requiredStringColumn(row, "body"),
    status,
    type,
    typeSource,
    agentId: optionalStringColumn(row, "agent_id"),
    order: requiredNumberColumn(row, "sort_order"),
    taskId: optionalStringColumn(row, "task_id"),
    threadId: optionalStringColumn(row, "thread_id"),
    teamJobId: optionalStringColumn(row, "team_job_id"),
    teamRoleId: optionalStringColumn(row, "team_role_id"),
    external,
    progress: optionalStringColumn(row, "progress"),
    error: optionalStringColumn(row, "error"),
    ...(phase === null ? {} : { phase }),
    statusTimes,
    statusChangedAt: requiredStringColumn(row, "status_changed_at"),
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
}

function decodeEvent(row: DynamicRecord): BoardTicketEvent {
  const kind = requiredStringColumn(row, "kind");
  const actor = requiredStringColumn(row, "actor");
  if (!isOneOf(BOARD_TICKET_EVENT_KINDS, kind)) throw new Error(`Unknown board ticket event: ${kind}`);
  if (!isOneOf(BOARD_TICKET_ACTORS, actor)) throw new Error(`Unknown board ticket actor: ${actor}`);
  const fromStatus = optionalStringColumn(row, "from_status");
  const toStatus = optionalStringColumn(row, "to_status");
  return {
    id: requiredStringColumn(row, "event_id"),
    ticketId: requiredStringColumn(row, "ticket_id"),
    kind,
    actor,
    fromStatus: fromStatus !== null && isBoardTicketStatus(fromStatus) ? fromStatus : null,
    toStatus: toStatus !== null && isBoardTicketStatus(toStatus) ? toStatus : null,
    text: optionalStringColumn(row, "text"),
    createdAt: requiredStringColumn(row, "created_at"),
  };
}

function decodeEvidence(row: DynamicRecord): { evidence: BoardTicketEvidence; storedName: string | null } {
  const kind = requiredStringColumn(row, "kind");
  const phase = requiredStringColumn(row, "phase");
  const actor = requiredStringColumn(row, "actor");
  if (!isOneOf(BOARD_TICKET_EVIDENCE_KINDS, kind)) throw new Error(`Unknown evidence kind: ${kind}`);
  if (!isOneOf(BOARD_TICKET_EVIDENCE_PHASES, phase)) throw new Error(`Unknown evidence phase: ${phase}`);
  if (!isOneOf(BOARD_TICKET_ACTORS, actor)) throw new Error(`Unknown evidence actor: ${actor}`);
  return {
    evidence: {
      id: requiredStringColumn(row, "evidence_id"),
      ticketId: requiredStringColumn(row, "ticket_id"),
      kind,
      phase,
      actor,
      caption: optionalStringColumn(row, "caption"),
      fileName: optionalStringColumn(row, "file_name"),
      mime: optionalStringColumn(row, "mime"),
      sizeBytes: requiredNumberColumn(row, "size_bytes"),
      text: optionalStringColumn(row, "text_content"),
      createdAt: requiredStringColumn(row, "created_at"),
    },
    storedName: optionalStringColumn(row, "stored_name"),
  };
}
