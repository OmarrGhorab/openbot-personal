import type { BoardTicket } from "@openbot/contracts/ipc";
import { BOARD_TICKETS_CAPABILITY, BOARD_TICKETS_ROUTES } from "@openbot/contracts/team-protocol/board-tickets-v1";
import { sourceText } from "@openbot/i18n/source";
import {
  parseBoardTicketId,
  parseCommentBoardTicket,
  parseCreateBoardTicket,
  parseMoveBoardTicket,
  parseStartBoardTicket,
  parseUpdateBoardTicket,
} from "../ipc/board-ticket-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent } from "./request-helpers";

const ROUTES = new Set<string>(Object.values(BOARD_TICKETS_ROUTES));

/** The refusals of the board that are catalog text for the admin. Any other failure stays private. */
const REFUSALS = [
  ["error.agent.boardTickets.notFound", 404],
  ["error.agent.boardTickets.emptyTitle", 400],
  ["error.agent.boardTickets.emptyComment", 400],
  ["error.agent.boardTickets.alreadyStarted", 409],
  ["error.agent.boardTickets.startUnavailable", 409],
] as const;

/**
 * The Tickets board of this computer, read and changed from a joined server. The board starts work
 * threads of the host's agents, so only an owner or admin can use it. A ticket of an agent that the
 * peer cannot see is not listed and not found. Frozen by `board-tickets-v1`.
 */
export async function routeBoardTickets(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  const board = admin?.boardTickets;
  if (!board || !capabilities.has(BOARD_TICKETS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.boardTicketsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the board-tickets wire codec.
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const visible = (ticket: BoardTicket) => ticket.agentId === null || !hiddenAgentIds.has(ticket.agentId);
  const requireVisibleTicket = (ticketId: string) => {
    const ticket = board.get(ticketId);
    if (!ticket || !visible(ticket)) throw new HttpError(404, sourceText("error.agent.boardTickets.notFound"));
  };
  try {
    switch (url.pathname) {
      case BOARD_TICKETS_ROUTES.list:
        return json(200, { tickets: board.list().filter(visible) });
      case BOARD_TICKETS_ROUTES.events: {
        const ticketId = parse(() => parseBoardTicketId(body.ticketId));
        requireVisibleTicket(ticketId);
        return json(200, { events: board.events(ticketId) });
      }
      case BOARD_TICKETS_ROUTES.create:
        return json(200, board.create(parse(() => parseCreateBoardTicket(body))));
      case BOARD_TICKETS_ROUTES.update: {
        const input = parse(() => parseUpdateBoardTicket(body));
        requireVisibleTicket(input.ticketId);
        return json(200, board.update(input));
      }
      case BOARD_TICKETS_ROUTES.move: {
        const input = parse(() => parseMoveBoardTicket(body));
        requireVisibleTicket(input.ticketId);
        return json(200, board.move(input));
      }
      case BOARD_TICKETS_ROUTES.comment: {
        const input = parse(() => parseCommentBoardTicket(body));
        requireVisibleTicket(input.ticketId);
        return json(200, board.comment(input));
      }
      case BOARD_TICKETS_ROUTES.start: {
        const input = parse(() => parseStartBoardTicket(body));
        if (input.ticketId !== undefined) requireVisibleTicket(input.ticketId);
        return json(200, await board.start(input));
      }
      default: {
        const ticketId = parse(() => parseBoardTicketId(body.ticketId));
        requireVisibleTicket(ticketId);
        board.delete(ticketId);
        return json(200, {});
      }
    }
  } catch (error) {
    if (error instanceof HttpError || !(error instanceof Error)) throw error;
    const refusal = REFUSALS.find(([key]) => sourceText(key) === error.message);
    if (refusal) throw new HttpError(refusal[1], error.message);
    throw error;
  }
}

function parse<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid ticket request.");
  }
}
