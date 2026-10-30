import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  BOARD_TICKET_BODY_LIMIT,
  BOARD_TICKET_COMMENT_LIMIT,
  BOARD_TICKET_ERROR_LIMIT,
  BOARD_TICKET_PROGRESS_LIMIT,
  BOARD_TICKET_SYNC_PROJECT_LIMIT,
  BOARD_TICKET_TITLE_LIMIT,
  type BoardTicketProvider,
  type BoardTicketStatus,
  type BoardTicketSyncTarget,
  type BoardTicketType,
  type CommentBoardTicketInput,
  type CreateBoardTicketInput,
  isBoardTicketProvider,
  isBoardTicketStatus,
  isBoardTicketType,
  type MoveBoardTicketInput,
  type StartBoardTicketInput,
  type UpdateBoardTicketInput,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

export function parseBoardTicketId(value: unknown): string {
  return requireString(value, "ticketId", INPUT_LIMITS.identifier);
}

function parseStatus(value: unknown): BoardTicketStatus {
  if (!isBoardTicketStatus(value)) throw new Error("Invalid ticket status.");
  return value;
}

/** A ticket type, or null to clear it. Absent: no change. */
function parseType(value: unknown): BoardTicketType | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isBoardTicketType(value)) throw new Error("Invalid ticket type.");
  return value;
}

function parseOptionalText(value: unknown, field: string, limit: number): string | undefined {
  if (value === undefined) return undefined;
  if (!isString(value) || value.length > limit) throw new Error(`Invalid ${field}.`);
  return value;
}

function parseNullableText(value: unknown, field: string, limit: number): string | null | undefined {
  if (value === null) return null;
  return parseOptionalText(value, field, limit);
}

function parseAgentId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  return requireString(value, "agentId", INPUT_LIMITS.identifier);
}

export function parseCreateBoardTicket(value: unknown): CreateBoardTicketInput {
  if (!isObject(value)) throw new Error("Invalid ticket request.");
  const body = parseOptionalText(value.body, "body", BOARD_TICKET_BODY_LIMIT);
  const agentId = parseAgentId(value.agentId);
  const type = parseType(value.type);
  return {
    title: requireString(value.title, "title", BOARD_TICKET_TITLE_LIMIT),
    ...(body === undefined ? {} : { body }),
    ...(value.status === undefined ? {} : { status: parseStatus(value.status) }),
    ...(agentId === undefined ? {} : { agentId }),
    ...(type === undefined ? {} : { type }),
  };
}

export function parseUpdateBoardTicket(value: unknown): UpdateBoardTicketInput {
  if (!isObject(value)) throw new Error("Invalid ticket request.");
  const title = parseOptionalText(value.title, "title", BOARD_TICKET_TITLE_LIMIT);
  const body = parseOptionalText(value.body, "body", BOARD_TICKET_BODY_LIMIT);
  const agentId = parseAgentId(value.agentId);
  const progress = parseNullableText(value.progress, "progress", BOARD_TICKET_PROGRESS_LIMIT);
  const error = parseNullableText(value.error, "error", BOARD_TICKET_ERROR_LIMIT);
  const type = parseType(value.type);
  return {
    ticketId: parseBoardTicketId(value.ticketId),
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
    ...(agentId === undefined ? {} : { agentId }),
    ...(type === undefined ? {} : { type }),
    ...(progress === undefined ? {} : { progress }),
    ...(error === undefined ? {} : { error }),
  };
}

export function parseMoveBoardTicket(value: unknown): MoveBoardTicketInput {
  if (!isObject(value)) throw new Error("Invalid ticket request.");
  const beforeTicketId =
    value.beforeTicketId === undefined || value.beforeTicketId === null
      ? null
      : parseBoardTicketId(value.beforeTicketId);
  return { ticketId: parseBoardTicketId(value.ticketId), status: parseStatus(value.status), beforeTicketId };
}

export function parseCommentBoardTicket(value: unknown): CommentBoardTicketInput {
  if (!isObject(value)) throw new Error("Invalid ticket request.");
  return {
    ticketId: parseBoardTicketId(value.ticketId),
    text: requireString(value.text, "text", BOARD_TICKET_COMMENT_LIMIT),
  };
}

export function parseStartBoardTicket(value: unknown): StartBoardTicketInput {
  if (!isObject(value)) throw new Error("Invalid ticket request.");
  const agentId = requireString(value.agentId, "agentId", INPUT_LIMITS.identifier);
  if (value.ticketId !== undefined) return { agentId, ticketId: parseBoardTicketId(value.ticketId) };
  const body = parseOptionalText(value.body, "body", BOARD_TICKET_BODY_LIMIT);
  return {
    agentId,
    title: requireString(value.title, "title", BOARD_TICKET_TITLE_LIMIT),
    ...(body === undefined ? {} : { body }),
  };
}

export function parseBoardTicketProvider(value: unknown): BoardTicketProvider {
  if (!isBoardTicketProvider(value)) throw new Error("Invalid ticket system.");
  return value;
}

/** A sync target, or null to stop the sync. */
export function parseBoardTicketSyncTarget(value: unknown): BoardTicketSyncTarget | null {
  if (value === null) return null;
  if (!isObject(value)) throw new Error("Invalid ticket sync request.");
  return {
    provider: parseBoardTicketProvider(value.provider),
    project: requireString(value.project, "project", BOARD_TICKET_SYNC_PROJECT_LIMIT),
  };
}
