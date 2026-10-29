import {
  type BoardTicket,
  type BoardTicketEvent,
  type BoardTicketsChanged,
  isBoardTicket,
  isBoardTicketEvent,
  isBoardTicketEventList,
  isBoardTicketList,
  isBoardTicketsChanged,
} from "@openbot/contracts/ipc";

export function decodeBoardTicket(value: unknown): BoardTicket {
  if (!isBoardTicket(value)) throw new Error("Invalid ticket response.");
  return value;
}

export function decodeBoardTickets(value: unknown): BoardTicket[] {
  if (!isBoardTicketList(value)) throw new Error("Invalid tickets response.");
  return value;
}

export function decodeBoardTicketEvent(value: unknown): BoardTicketEvent {
  if (!isBoardTicketEvent(value)) throw new Error("Invalid ticket activity response.");
  return value;
}

export function decodeBoardTicketEvents(value: unknown): BoardTicketEvent[] {
  if (!isBoardTicketEventList(value)) throw new Error("Invalid ticket activity response.");
  return value;
}

export function decodeBoardTicketsChanged(value: unknown): BoardTicketsChanged {
  if (!isBoardTicketsChanged(value)) throw new Error("Invalid ticket change event.");
  return value;
}
