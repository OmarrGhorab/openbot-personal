// The Tickets board: list, create, update, move, comment, start and delete, and the sync with a
// connected ticket system. The board requests are server-scoped: this computer's board is in its own
// database, and a joined server serves its board through `board-tickets-v1`. The sync is a plain request
// on this computer. The change events of this computer go out from the services.

import {
  type BoardTicket,
  type BoardTicketEvent,
  isBoardTicket,
  isBoardTicketEvent,
  isBoardTicketEventList,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { BOARD_TICKETS_CAPABILITY, BOARD_TICKETS_ROUTES } from "@openbot/contracts/team-protocol/board-tickets-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import type { BoardTicketService } from "../../backend/board-tickets/board-ticket-service";
import type { BoardTicketSync } from "../../backend/board-tickets/board-ticket-sync";
import { runCauseEffect } from "../../backend/effect-boundary";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import {
  parseAttachBoardTicketEvidence,
  parseBoardTicketEvidenceId,
  parseBoardTicketId,
  parseBoardTicketProvider,
  parseBoardTicketSyncTarget,
  parseCommentBoardTicket,
  parseCreateBoardTicket,
  parseMoveBoardTicket,
  parseStartBoardTicket,
  parseUpdateBoardTicket,
} from "./board-ticket-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

interface BoardTicketRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

interface BoardTicketIpcDependencies {
  /** Asks the person for one evidence file; null when they close the dialog. */
  chooseEvidenceFile?: () => Promise<string | null>;
  /** Opens a stored screenshot or recording in the computer's own viewer. */
  openPath?: (path: string) => Promise<void>;
  boardTickets: BoardTicketService;
  boardTicketSync: BoardTicketSync;
  remoteServers: BoardTicketRemoteServers;
}

/**
 * A ticket from a joined server, or null when it is not one. The frozen board-tickets-v1 wire carries no
 * ticket type, so such a ticket has the type "not set yet". A field that the server did send stays as it is.
 */
function wireTicket(value: unknown): BoardTicket | null {
  const typed = isDynamicRecord(value) && !("type" in value) ? { ...value, type: null, typeSource: null } : value;
  return isBoardTicket(typed) ? typed : null;
}

const decodeTicket: ResponseDecoder<BoardTicket> = (input) => {
  const ticket = wireTicket(input);
  if (!ticket) throw new Error("The server sent an invalid ticket.");
  return ticket;
};

const decodeEvent: ResponseDecoder<BoardTicketEvent> = (value) => {
  if (!isBoardTicketEvent(value)) throw new Error("The server sent an invalid ticket comment.");
  return value;
};

const decodeTickets: ResponseDecoder<BoardTicket[]> = (value) => {
  const tickets = isDynamicRecord(value) && Array.isArray(value.tickets) ? value.tickets.map(wireTicket) : null;
  if (!tickets?.every((ticket) => ticket !== null)) throw new Error("The server sent an invalid board.");
  return tickets.filter((ticket) => ticket !== null);
};

const decodeEvents: ResponseDecoder<BoardTicketEvent[]> = (value) => {
  if (!isDynamicRecord(value) || !isBoardTicketEventList(value.events))
    throw new Error("The server sent an invalid ticket activity.");
  return value.events;
};

export function boardTicketIpcHandlers({
  chooseEvidenceFile,
  openPath,
  boardTickets,
  boardTicketSync,
  remoteServers,
}: BoardTicketIpcDependencies): Pick<IpcGroupHandlers, "boardTickets"> {
  // A joined server without `board-tickets-v1` keeps its board to itself.
  function remote<T>(serverId: string, path: string, body: unknown, decode: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, BOARD_TICKETS_CAPABILITY))
      throw new Error(sourceText("error.team.boardTicketsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decode, { method: "POST", body }));
  }

  return {
    boardTickets: {
      list: scopedQueryHandler({
        local: () => boardTickets.list(),
        remote: (serverId) => remote(serverId, BOARD_TICKETS_ROUTES.list, {}, decodeTickets),
      }),
      events: scopedHandler(parseBoardTicketId, {
        local: (ticketId) => boardTickets.events(ticketId),
        remote: (ticketId, serverId) => remote(serverId, BOARD_TICKETS_ROUTES.events, { ticketId }, decodeEvents),
      }),
      create: scopedHandler(parseCreateBoardTicket, {
        local: (input) => boardTickets.create(input),
        remote: (input, serverId) => remote(serverId, BOARD_TICKETS_ROUTES.create, input, decodeTicket),
      }),
      update: scopedHandler(parseUpdateBoardTicket, {
        local: (input) => boardTickets.update(input),
        remote: (input, serverId) => remote(serverId, BOARD_TICKETS_ROUTES.update, input, decodeTicket),
      }),
      move: scopedHandler(parseMoveBoardTicket, {
        local: (input) => boardTickets.move(input),
        remote: (input, serverId) => remote(serverId, BOARD_TICKETS_ROUTES.move, input, decodeTicket),
      }),
      comment: scopedHandler(parseCommentBoardTicket, {
        local: (input) => boardTickets.comment(input),
        remote: (input, serverId) => remote(serverId, BOARD_TICKETS_ROUTES.comment, input, decodeEvent),
      }),
      start: scopedHandler(parseStartBoardTicket, {
        local: (input) => boardTickets.start(input),
        remote: (input, serverId) => remote(serverId, BOARD_TICKETS_ROUTES.start, input, decodeTicket),
      }),
      delete: scopedHandler(parseBoardTicketId, {
        local: (ticketId) => boardTickets.delete(ticketId),
        remote: (ticketId, serverId) => remote(serverId, BOARD_TICKETS_ROUTES.delete, { ticketId }, acceptEmpty),
      }),
      evidence: payloadHandler(parseBoardTicketId, (ticketId) => boardTickets.evidence(ticketId)),
      attachEvidence: payloadHandler(parseAttachBoardTicketEvidence, async (input) => {
        const path = chooseEvidenceFile ? await chooseEvidenceFile() : null;
        if (!path) return null;
        return boardTickets.attachEvidence({ ...input, path }, "user");
      }),
      evidenceImage: payloadHandler(parseBoardTicketEvidenceId, (evidenceId) => boardTickets.evidenceImage(evidenceId)),
      openEvidence: payloadHandler(parseBoardTicketEvidenceId, async (evidenceId) => {
        const path = boardTickets.evidenceFile(evidenceId);
        if (!path) throw new Error(sourceText("error.agent.boardTickets.evidenceNotFound"));
        await openPath?.(path);
      }),
      syncState: handler(() => boardTicketSync.state()),
      syncProjects: payloadHandler(parseBoardTicketProvider, (provider) =>
        runCauseEffect(boardTicketSync.projects(provider)),
      ),
      setSyncTarget: payloadHandler(parseBoardTicketSyncTarget, (target) =>
        runCauseEffect(boardTicketSync.setTarget(target)),
      ),
      syncNow: handler(() => runCauseEffect(boardTicketSync.syncNow())),
    },
  };
}
