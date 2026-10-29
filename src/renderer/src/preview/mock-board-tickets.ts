// The Tickets board group of the preview: tickets and their activity in memory. No agent runs, so a
// ticket moves only when the preview moves it. The board starts empty, as it does after the upgrade;
// a story or a smoke check passes seed tickets.

import type {
  BoardTicket,
  BoardTicketActor,
  BoardTicketEvent,
  BoardTicketEventKind,
  BoardTicketStatus,
  BoardTicketsChanged,
  OpenBotDesktopApi,
} from "@openbot/contracts/ipc";

type BoardTicketsApi = OpenBotDesktopApi["boardTickets"];

export function mockBoardTickets(seed: readonly BoardTicket[] = []): BoardTicketsApi {
  let tickets: BoardTicket[] = seed.map((ticket) => ({ ...ticket, statusTimes: { ...ticket.statusTimes } }));
  const events: BoardTicketEvent[] = [];
  const listeners = new Set<(payload: BoardTicketsChanged) => void>();
  let sequence = 0;
  const now = () => new Date().toISOString();
  const nextId = (prefix: string) => {
    sequence += 1;
    return `preview-${prefix}-${sequence}`;
  };
  const emitChanged = (ticketIds: string[]) => {
    for (const listener of listeners) listener({ ticketIds });
  };
  const find = (ticketId: string): BoardTicket => {
    const ticket = tickets.find((candidate) => candidate.id === ticketId);
    if (!ticket) throw new Error("The ticket was not found. It may have been deleted.");
    return ticket;
  };
  const addEvent = (
    ticketId: string,
    kind: BoardTicketEventKind,
    actor: BoardTicketActor,
    detail: { fromStatus?: BoardTicketStatus | null; toStatus?: BoardTicketStatus | null; text?: string | null },
  ): BoardTicketEvent => {
    const event: BoardTicketEvent = {
      id: nextId("event"),
      ticketId,
      kind,
      actor,
      fromStatus: detail.fromStatus ?? null,
      toStatus: detail.toStatus ?? null,
      text: detail.text ?? null,
      createdAt: now(),
    };
    events.push(event);
    return event;
  };
  const endOrder = (status: BoardTicketStatus) =>
    Math.max(0, ...tickets.filter((ticket) => ticket.status === status).map((ticket) => ticket.order)) + 1;
  const replace = (next: BoardTicket) => {
    tickets = tickets.map((ticket) => (ticket.id === next.id ? next : ticket));
    emitChanged([next.id]);
    return next;
  };

  const api: BoardTicketsApi = {
    list: async () => [...tickets].sort((left, right) => left.order - right.order),
    events: async (ticketId) => {
      find(ticketId);
      return events.filter((event) => event.ticketId === ticketId);
    },
    create: async (input) => {
      const title = input.title.replace(/\s+/gu, " ").trim();
      if (!title) throw new Error("Write a title for the ticket.");
      const status = input.status ?? "backlog";
      const time = now();
      const ticket: BoardTicket = {
        id: nextId("ticket"),
        title,
        body: input.body ?? "",
        status,
        agentId: input.agentId ?? null,
        order: endOrder(status),
        taskId: null,
        threadId: null,
        teamJobId: null,
        teamRoleId: null,
        external: null,
        progress: null,
        error: null,
        statusTimes: { [status]: time },
        statusChangedAt: time,
        createdAt: time,
        updatedAt: time,
      };
      tickets = [...tickets, ticket];
      addEvent(ticket.id, "created", "user", { toStatus: status });
      emitChanged([ticket.id]);
      return ticket;
    },
    update: async (input) => {
      const current = find(input.ticketId);
      if (input.agentId !== undefined && input.agentId !== current.agentId) {
        addEvent(current.id, "assigned", "user", { text: input.agentId });
      }
      return replace({
        ...current,
        ...(input.title === undefined ? {} : { title: input.title.trim() || current.title }),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        ...(input.error === undefined ? {} : { error: input.error }),
        updatedAt: now(),
      });
    },
    move: async (input) => {
      const current = find(input.ticketId);
      const before = input.beforeTicketId ? tickets.find((ticket) => ticket.id === input.beforeTicketId) : undefined;
      const column = tickets
        .filter((ticket) => ticket.status === input.status && ticket.id !== current.id)
        .sort((left, right) => left.order - right.order);
      let order = endOrder(input.status);
      if (before && before.status === input.status) {
        const index = column.findIndex((ticket) => ticket.id === before.id);
        const previous = column[index - 1];
        order = previous ? (previous.order + before.order) / 2 : before.order - 1;
      }
      const time = now();
      const changed = current.status !== input.status;
      if (changed) addEvent(current.id, "moved", "user", { fromStatus: current.status, toStatus: input.status });
      return replace({
        ...current,
        status: input.status,
        order,
        statusTimes: changed ? { ...current.statusTimes, [input.status]: time } : current.statusTimes,
        statusChangedAt: changed ? time : current.statusChangedAt,
        updatedAt: time,
      });
    },
    comment: async (input) => {
      find(input.ticketId);
      const text = input.text.trim();
      if (!text) throw new Error("Write a comment before you send it.");
      const event = addEvent(input.ticketId, "comment", "user", { text });
      emitChanged([input.ticketId]);
      return event;
    },
    // No agent runs in the preview: a started ticket gets no work thread and waits in Queued.
    start: async (input) => {
      const ticket =
        input.ticketId === undefined
          ? await api.create({
              title: input.title ?? "",
              ...(input.body === undefined ? {} : { body: input.body }),
              agentId: input.agentId,
            })
          : find(input.ticketId);
      if (ticket.agentId !== input.agentId) await api.update({ ticketId: ticket.id, agentId: input.agentId });
      return api.move({ ticketId: ticket.id, status: "queued" });
    },
    delete: async (ticketId) => {
      find(ticketId);
      tickets = tickets.filter((ticket) => ticket.id !== ticketId);
      emitChanged([ticketId]);
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return api;
}
