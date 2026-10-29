// Frozen optional board-tickets-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and change the Tickets board of that host. They list the tickets and read the
// activity of one ticket, and they create, change, move, comment on, start and delete tickets. A
// start creates the ticket when it has no id yet, and starts one work thread of its agent on the
// host. A member cannot use any route; `requireAdmin` on the host is the only gate. A ticket of an
// agent that the peer cannot see is not listed, and a change to it is not found (404). The sync with
// GitHub, Jira and Linear is not part of this contract: it stays on the computer that connected
// them. Every route is a POST with its ids in the body. Bounds and meaning do not follow IPC changes;
// widening any of it needs a second capability string.
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const BOARD_TICKETS_CAPABILITY = "board-tickets-v1";

export const BOARD_TICKETS_ROUTES = {
  list: "/v1/admin/board-tickets",
  events: "/v1/admin/board-tickets/events",
  create: "/v1/admin/board-tickets/create",
  update: "/v1/admin/board-tickets/update",
  move: "/v1/admin/board-tickets/move",
  comment: "/v1/admin/board-tickets/comment",
  start: "/v1/admin/board-tickets/start",
  delete: "/v1/admin/board-tickets/delete",
} as const;

const status = oneOf("backlog", "queued", "running", "needs_review", "done");
const provider = oneOf("github", "jira", "linear");
const title = string(200);
const body = string(20_000);
const progress = nullable(string(500));
const error = nullable(string(2_000));
const text = string(4_000);
const time = string(160);
const optionalId = nullable(identifier);

const order: AdminDecoder = (input) => {
  if (typeof input !== "number" || !Number.isFinite(input)) throw new Error("Invalid ticket order.");
  return input;
};

/** When the ticket last entered each column. Only column names are keys. */
const statusTimes: AdminDecoder = (input) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Invalid ticket times.");
  const times: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    status(key);
    const entered = time(value);
    if (typeof entered === "string") times[key] = entered;
  }
  return times;
};

const external = nullable(fields({ provider, key: string(300), url: string(2_000) }));

const ticket = fields({
  id: identifier,
  title,
  body,
  status,
  agentId: optionalId,
  order,
  taskId: optionalId,
  threadId: optionalId,
  teamJobId: optionalId,
  teamRoleId: optionalId,
  external,
  progress,
  error,
  statusTimes,
  statusChangedAt: time,
  createdAt: time,
  updatedAt: time,
});

const event = fields({
  id: identifier,
  ticketId: identifier,
  kind: oneOf("created", "moved", "assigned", "comment", "progress"),
  actor: oneOf("user", "agent", "sync"),
  fromStatus: nullable(status),
  toStatus: nullable(status),
  text: nullable(text),
  createdAt: time,
});

const ticketId = fields({ ticketId: identifier });

export const BOARD_TICKETS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BOARD_TICKETS_ROUTES.list, adminRoute(empty, fields({ tickets: list(ticket, 2_000) }))],
  [BOARD_TICKETS_ROUTES.events, adminRoute(ticketId, fields({ events: list(event, 500) }))],
  [BOARD_TICKETS_ROUTES.create, adminRoute(fields({ title }, { body, status, agentId: optionalId }), ticket)],
  [
    BOARD_TICKETS_ROUTES.update,
    adminRoute(fields({ ticketId: identifier }, { title, body, agentId: optionalId, progress, error }), ticket),
  ],
  [BOARD_TICKETS_ROUTES.move, adminRoute(fields({ ticketId: identifier, status }, { beforeTicketId: optionalId }), ticket)],
  [BOARD_TICKETS_ROUTES.comment, adminRoute(fields({ ticketId: identifier, text }), event)],
  [BOARD_TICKETS_ROUTES.start, adminRoute(fields({ agentId: identifier }, { ticketId: identifier, title, body }), ticket)],
  [BOARD_TICKETS_ROUTES.delete, adminRoute(ticketId, empty)],
]);
