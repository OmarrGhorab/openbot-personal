import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  BOARD_TICKET_EVIDENCE_CAPTION_LIMIT,
  BOARD_TICKET_EVIDENCE_IMAGE_BYTES,
  BOARD_TICKET_EVIDENCE_LIMIT,
  BOARD_TICKET_EVIDENCE_RECORDING_BYTES,
  BOARD_TICKET_EVIDENCE_TEXT_LIMIT,
  type BoardTicketActor,
  type BoardTicketEvidence,
  type BoardTicketEvidenceKind,
  type BoardTicketEvidencePhase,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { BoardTicketStore } from "./board-ticket-store";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const RECORDING_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};
const DIFF_EXTENSIONS = new Set([".diff", ".patch"]);

/** What to attach: a file at an absolute path, or text (test output or a diff) given inline. */
export interface BoardTicketEvidenceInput {
  ticketId: string;
  phase: BoardTicketEvidencePhase;
  /** Read from the file when absent: an image is a screenshot, a video a recording, `.diff` a diff. */
  kind?: BoardTicketEvidenceKind | undefined;
  caption?: string | undefined;
  path?: string | undefined;
  text?: string | undefined;
}

/** The kind that a file's extension gives, or null for a file that is no evidence OpenBot can show. */
export function evidenceKindOfPath(path: string): BoardTicketEvidenceKind {
  const extension = extname(path).toLowerCase();
  if (extension in IMAGE_TYPES) return "screenshot";
  if (extension in RECORDING_TYPES) return "recording";
  if (DIFF_EXTENSIONS.has(extension)) return "diff";
  return "test_output";
}

/**
 * The evidence of the Tickets board (#236, #264): screenshots and recordings are copied into the app
 * data folder `ticket-evidence/<ticket>/`, so they outlive the worktree they came from; test output
 * and diffs are stored as text. Every limit is checked before anything is written.
 */
export class BoardTicketEvidenceStore {
  readonly #store: BoardTicketStore;
  readonly #directory: string;

  constructor(store: BoardTicketStore, directory: string) {
    this.#store = store;
    this.#directory = directory;
  }

  list(ticketId: string): BoardTicketEvidence[] {
    return this.#store.evidence(ticketId);
  }

  async add(input: BoardTicketEvidenceInput, actor: BoardTicketActor): Promise<BoardTicketEvidence> {
    if (this.#store.evidenceCount(input.ticketId) >= BOARD_TICKET_EVIDENCE_LIMIT) {
      throw new Error(sourceText("error.agent.boardTickets.evidenceLimit", { count: BOARD_TICKET_EVIDENCE_LIMIT }));
    }
    const caption = input.caption?.trim().slice(0, BOARD_TICKET_EVIDENCE_CAPTION_LIMIT) || null;
    const kind = input.kind ?? (input.path ? evidenceKindOfPath(input.path) : "test_output");
    if (kind === "screenshot" || kind === "recording") {
      if (!input.path) throw new Error(sourceText("error.agent.boardTickets.evidenceNeedsFile"));
      const extension = extname(input.path).toLowerCase();
      const mime = (kind === "screenshot" ? IMAGE_TYPES : RECORDING_TYPES)[extension];
      if (!mime) throw new Error(sourceText("error.agent.boardTickets.evidenceType"));
      const size = (await stat(input.path)).size;
      const limit = kind === "screenshot" ? BOARD_TICKET_EVIDENCE_IMAGE_BYTES : BOARD_TICKET_EVIDENCE_RECORDING_BYTES;
      if (size > limit) {
        throw new Error(sourceText("error.agent.boardTickets.evidenceTooLarge", { megabytes: limit / 1024 / 1024 }));
      }
      const id = randomUUID();
      const storedName = `${id}${extension}`;
      const folder = join(this.#directory, safeSegment(input.ticketId));
      await mkdir(folder, { recursive: true });
      await copyFile(input.path, join(folder, storedName));
      try {
        return this.#store.addEvidence({
          id,
          ticketId: input.ticketId,
          kind,
          phase: input.phase,
          actor,
          caption,
          fileName: basename(input.path).slice(0, 300),
          mime,
          sizeBytes: size,
          text: null,
          storedName,
        });
      } catch (error) {
        await rm(join(folder, storedName), { force: true });
        throw error;
      }
    }
    let text = input.text;
    let fileName: string | null = null;
    let size = 0;
    if (text === undefined && input.path) {
      size = (await stat(input.path)).size;
      if (size > BOARD_TICKET_EVIDENCE_TEXT_LIMIT * 4) {
        throw new Error(
          sourceText("error.agent.boardTickets.evidenceTextTooLong", { count: BOARD_TICKET_EVIDENCE_TEXT_LIMIT }),
        );
      }
      text = await readFile(input.path, "utf8");
      fileName = basename(input.path).slice(0, 300);
    }
    if (!text?.trim()) throw new Error(sourceText("error.agent.boardTickets.evidenceEmpty"));
    if (text.length > BOARD_TICKET_EVIDENCE_TEXT_LIMIT) {
      throw new Error(
        sourceText("error.agent.boardTickets.evidenceTextTooLong", { count: BOARD_TICKET_EVIDENCE_TEXT_LIMIT }),
      );
    }
    return this.#store.addEvidence({
      ticketId: input.ticketId,
      kind,
      phase: input.phase,
      actor,
      caption,
      fileName,
      mime: null,
      sizeBytes: size || Buffer.byteLength(text),
      text,
      storedName: null,
    });
  }

  /** The stored file of a screenshot or a recording, or null. */
  filePath(evidenceId: string): { path: string; evidence: BoardTicketEvidence } | null {
    const found = this.#store.evidenceById(evidenceId);
    if (!found?.storedName) return null;
    return {
      path: join(this.#directory, safeSegment(found.evidence.ticketId), safeSegment(found.storedName)),
      evidence: found.evidence,
    };
  }

  /** A screenshot as a data URL, for its thumbnail. Null for any other kind. */
  async imageDataUrl(evidenceId: string): Promise<string | null> {
    const file = this.filePath(evidenceId);
    if (!file || file.evidence.kind !== "screenshot" || !file.evidence.mime) return null;
    const bytes = await readFile(file.path).catch(() => null);
    return bytes ? `data:${file.evidence.mime};base64,${bytes.toString("base64")}` : null;
  }

  /** Removes the files of a deleted ticket. Its rows go with the ticket. */
  async removeTicket(ticketId: string): Promise<void> {
    await rm(join(this.#directory, safeSegment(ticketId)), { recursive: true, force: true });
  }
}

/** One path segment, so no stored id can name a folder outside the evidence folder. */
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "_").replace(/^\.+/u, "_");
}
