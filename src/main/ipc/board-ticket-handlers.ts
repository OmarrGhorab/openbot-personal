// The Tickets board of this computer: list, create, update, move, comment, start and delete, and the sync
// with a connected ticket system. Every endpoint is a plain request on this computer; the change events go
// out from the services.

import type { BoardTicketService } from "../../backend/board-tickets/board-ticket-service";
import type { BoardTicketSync } from "../../backend/board-tickets/board-ticket-sync";
import { runCauseEffect } from "../../backend/effect-boundary";
import {
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

interface BoardTicketIpcDependencies {
  boardTickets: BoardTicketService;
  boardTicketSync: BoardTicketSync;
}

export function boardTicketIpcHandlers({
  boardTickets,
  boardTicketSync,
}: BoardTicketIpcDependencies): Pick<IpcGroupHandlers, "boardTickets"> {
  return {
    boardTickets: {
      list: handler(() => boardTickets.list()),
      events: payloadHandler(parseBoardTicketId, (ticketId) => boardTickets.events(ticketId)),
      create: payloadHandler(parseCreateBoardTicket, (input) => boardTickets.create(input)),
      update: payloadHandler(parseUpdateBoardTicket, (input) => boardTickets.update(input)),
      move: payloadHandler(parseMoveBoardTicket, (input) => boardTickets.move(input)),
      comment: payloadHandler(parseCommentBoardTicket, (input) => boardTickets.comment(input)),
      start: payloadHandler(parseStartBoardTicket, (input) => boardTickets.start(input)),
      delete: payloadHandler(parseBoardTicketId, (ticketId) => boardTickets.delete(ticketId)),
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
