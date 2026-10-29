// The Tickets board of this computer: list, create, update, move, comment, start and delete. Every endpoint is
// a plain request on this computer; the change event goes out from the service.

import type { BoardTicketService } from "../../backend/board-tickets/board-ticket-service";
import {
  parseBoardTicketId,
  parseCommentBoardTicket,
  parseCreateBoardTicket,
  parseMoveBoardTicket,
  parseStartBoardTicket,
  parseUpdateBoardTicket,
} from "./board-ticket-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

interface BoardTicketIpcDependencies {
  boardTickets: BoardTicketService;
}

export function boardTicketIpcHandlers({
  boardTickets,
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
    },
  };
}
