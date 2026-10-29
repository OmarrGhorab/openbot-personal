// The Tickets board group of the preview: tickets and their activity in memory. The board starts empty,
// as it does after the upgrade; a story or a smoke check passes seed tickets. With `startThread`, a
// started ticket gets a mock work thread of the agent mock. With `followTasks`, the agent moves the
// ticket of each work thread as the desktop does: Running while a turn runs, Needs review when it ends,
// and back to Backlog with the failure line when it fails or is stopped. With `sync`, ticket systems are
// connected: the board imports the open issues of the chosen project into Backlog, as the desktop does.

import {
  type AgentTasksSnapshot,
  type BoardTicket,
  type BoardTicketActor,
  type BoardTicketEvent,
  type BoardTicketEventKind,
  type BoardTicketExternal,
  type BoardTicketProvider,
  type BoardTicketStatus,
  type BoardTicketSyncState,
  type BoardTicketSyncTarget,
  type BoardTicketsChanged,
  boardTicketWorkStep,
  type CreateBoardTicketInput,
  type MoveBoardTicketInput,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

type BoardTicketsApi = OpenBotDesktopApi["boardTickets"];

/** Starts a mock work thread of the agent with the text, and returns its task and thread IDs. */
type StartMockThread = (agentId: string, text: string) => { taskId: string; threadId: string };

/** Hands each task list of the agent mock to the listener, as `agent-tasks-changed` does. */
type FollowMockTasks = (listener: (snapshot: AgentTasksSnapshot) => void) => void;

/** The connected ticket systems of the preview, their projects, and the open issues of each project. */
export interface PreviewBoardTicketSync {
  providers: BoardTicketProvider[];
  projects: Partial<Record<BoardTicketProvider, string[]>>;
  issues: Record<string, { key: string; title: string; body: string; url: string }[]>;
}

const NO_SYNC: PreviewBoardTicketSync = { providers: [], projects: {}, issues: {} };

export function mockBoardTickets(
  seed: readonly BoardTicket[] = [],
  startThread?: StartMockThread,
  followTasks?: FollowMockTasks,
  sync: PreviewBoardTicketSync = NO_SYNC,
): BoardTicketsApi {
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

  const moveTicket = (input: MoveBoardTicketInput, actor: BoardTicketActor): BoardTicket => {
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
    if (changed) addEvent(current.id, "moved", actor, { fromStatus: current.status, toStatus: input.status });
    return replace({
      ...current,
      status: input.status,
      order,
      statusTimes: changed ? { ...current.statusTimes, [input.status]: time } : current.statusTimes,
      statusChangedAt: changed ? time : current.statusChangedAt,
      updatedAt: time,
    });
  };

  const createTicket = (
    input: CreateBoardTicketInput,
    actor: BoardTicketActor,
    external: BoardTicketExternal | null,
  ): BoardTicket => {
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
      external,
      progress: null,
      error: null,
      statusTimes: { [status]: time },
      statusChangedAt: time,
      createdAt: time,
      updatedAt: time,
    };
    tickets = [...tickets, ticket];
    addEvent(ticket.id, "created", actor, { toStatus: status });
    emitChanged([ticket.id]);
    return ticket;
  };

  let syncTarget: BoardTicketSyncTarget | null = null;
  let lastSyncedAt: string | null = null;
  const syncListeners = new Set<(state: BoardTicketSyncState) => void>();
  const syncState = (): BoardTicketSyncState => ({
    providers: [...sync.providers],
    target: syncTarget ? { ...syncTarget } : null,
    lastSyncedAt,
    error: null,
  });
  const announceSync = (): BoardTicketSyncState => {
    const state = syncState();
    for (const listener of syncListeners) listener(state);
    return state;
  };
  const requireConnected = (provider: BoardTicketProvider) => {
    if (!sync.providers.includes(provider)) throw new Error(sourceText("error.agent.boardTickets.syncNotConnected"));
  };
  // Adds each open issue of the target to Backlog once, linked to it. A linked ticket takes the new title.
  const importIssues = () => {
    const target = syncTarget;
    if (!target) return;
    for (const issue of sync.issues[target.project] ?? []) {
      const linked = tickets.find(
        (ticket) => ticket.external?.provider === target.provider && ticket.external.key === issue.key,
      );
      if (!linked) {
        createTicket({ title: issue.title, body: issue.body }, "sync", {
          provider: target.provider,
          key: issue.key,
          url: issue.url,
        });
      } else if (linked.title !== issue.title || linked.body !== issue.body) {
        replace({ ...linked, title: issue.title, body: issue.body, updatedAt: now() });
      }
    }
    lastSyncedAt = now();
  };

  const api: BoardTicketsApi = {
    list: async () => [...tickets].sort((left, right) => left.order - right.order),
    events: async (ticketId) => {
      find(ticketId);
      return events.filter((event) => event.ticketId === ticketId);
    },
    create: async (input) => createTicket(input, "user", null),
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
    move: async (input) => moveTicket(input, "user"),
    comment: async (input) => {
      find(input.ticketId);
      const text = input.text.trim();
      if (!text) throw new Error("Write a comment before you send it.");
      const event = addEvent(input.ticketId, "comment", "user", { text });
      emitChanged([input.ticketId]);
      return event;
    },
    // Without `startThread`, a started ticket gets no work thread and waits in Queued. With it, the
    // ticket runs in a new mock thread, as a start on this computer does.
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
      if (!startThread) return api.move({ ticketId: ticket.id, status: "queued" });
      const moved = await api.move({ ticketId: ticket.id, status: "running" });
      if (moved.taskId) return moved;
      const thread = startThread(input.agentId, [moved.title, moved.body.trim()].filter(Boolean).join("\n\n"));
      return replace({ ...moved, taskId: thread.taskId, threadId: thread.threadId, updatedAt: now() });
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
    syncState: async () => syncState(),
    syncProjects: async (provider) => {
      requireConnected(provider);
      return [...(sync.projects[provider] ?? [])];
    },
    setSyncTarget: async (target) => {
      if (target === null) {
        syncTarget = null;
        lastSyncedAt = null;
        return announceSync();
      }
      requireConnected(target.provider);
      syncTarget = { provider: target.provider, project: target.project.trim() };
      importIssues();
      return announceSync();
    },
    syncNow: async () => {
      importIssues();
      return announceSync();
    },
    onSyncChanged: (listener) => {
      syncListeners.add(listener);
      return () => {
        syncListeners.delete(listener);
      };
    },
  };
  // The agent moves the ticket of each work thread, with the rule of the desktop: only when the column
  // that the thread asks for changes, and never out of Done unless a new turn runs.
  const asked = new Map<string, BoardTicketStatus>();
  followTasks?.((snapshot) => {
    for (const task of snapshot.tasks) {
      const step = boardTicketWorkStep(task);
      if (!step || asked.get(task.id) === step.status) continue;
      const ticket = tickets.find((candidate) => candidate.taskId === task.id);
      if (!ticket) continue;
      asked.set(task.id, step.status);
      if (ticket.status === "done" && step.status !== "running") continue;
      const error =
        step.failure === null
          ? null
          : step.failure === "stopped"
            ? sourceText("error.agent.boardTickets.threadStopped")
            : task.error || sourceText("error.agent.boardTickets.threadFailed");
      if (error !== ticket.error && (error !== null || step.status === "running")) {
        replace({ ...ticket, error, updatedAt: now() });
      }
      if (ticket.status !== step.status) moveTicket({ ticketId: ticket.id, status: step.status }, "agent");
    }
  });
  return api;
}
