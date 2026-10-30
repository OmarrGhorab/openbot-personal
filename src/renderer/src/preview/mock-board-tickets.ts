// The Tickets board group of the preview: tickets and their activity in memory. The board starts empty,
// as it does after the upgrade; a story or a smoke check passes seed tickets. With `startThread`, a
// started ticket gets a mock work thread of the agent mock. With `followTasks`, the agent moves the
// ticket of each work thread as the desktop does: Running while a turn runs, Needs review when it ends,
// and back to Backlog with the failure line when it fails or is stopped. With `sync`, ticket systems are
// connected: the board imports the open issues of the chosen project into Backlog, as the desktop does.
// With `followTeam`, each Raven team job gets its own ticket and one ticket for each role, assigned to the
// role's agent, and they move with the job by the rule of the desktop. Each new ticket gets a type with the
// rule of the desktop (`detectBoardTicketType`): the labels of a synced issue first, then the title and
// the text. A type that the person chose wins over detection.

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
  type BoardTicketTeamFailure,
  type BoardTicketTeamStep,
  type BoardTicketType,
  boardTicketTeamJobStep,
  boardTicketTeamRoleStep,
  boardTicketWorkStep,
  type CreateBoardTicketInput,
  detectBoardTicketType,
  type MoveBoardTicketInput,
  type OpenBotDesktopApi,
  type RavenTeamJob,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

type BoardTicketsApi = OpenBotDesktopApi["boardTickets"];

/** Starts a mock work thread of the agent with the text, and returns its task and thread IDs. */
type StartMockThread = (agentId: string, text: string) => { taskId: string; threadId: string };

/** Hands each task list of the agent mock to the listener, as `agent-tasks-changed` does. */
type FollowMockTasks = (listener: (snapshot: AgentTasksSnapshot) => void) => void;

/** Hands each changed job of the Raven Stack team mock to the listener, as the team's change event does. */
type FollowMockTeam = (listener: (job: RavenTeamJob) => void) => void;

/** The connected ticket systems of the preview, their projects, and the open issues of each project. */
export interface PreviewBoardTicketSync {
  providers: BoardTicketProvider[];
  projects: Partial<Record<BoardTicketProvider, string[]>>;
  issues: Record<string, { key: string; title: string; body: string; url: string; labels?: string[] }[]>;
}

const NO_SYNC: PreviewBoardTicketSync = { providers: [], projects: {}, issues: {} };

export function mockBoardTickets(
  seed: readonly BoardTicket[] = [],
  startThread?: StartMockThread,
  followTasks?: FollowMockTasks,
  sync: PreviewBoardTicketSync = NO_SYNC,
  followTeam?: FollowMockTeam,
): BoardTicketsApi {
  let tickets: BoardTicket[] = seed.map((ticket) => ({ ...ticket, statusTimes: { ...ticket.statusTimes } }));
  const typeEvent = (ticket: BoardTicket, type: BoardTicketType | null, actor: BoardTicketActor) => {
    if (type !== ticket.type) addEvent(ticket.id, "type_changed", actor, { text: type });
  };
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
    labels: readonly string[] = [],
  ): BoardTicket => {
    const title = input.title.replace(/\s+/gu, " ").trim();
    if (!title) throw new Error("Write a title for the ticket.");
    const status = input.status ?? "backlog";
    const time = now();
    const body = input.body ?? "";
    const chosen = input.type !== undefined;
    const type = chosen ? (input.type ?? null) : detectBoardTicketType({ labels, title, body });
    const ticket: BoardTicket = {
      id: nextId("ticket"),
      title,
      body,
      status,
      type,
      typeSource: chosen ? (actor === "agent" ? "agent" : "user") : type ? "detected" : null,
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
        createTicket(
          { title: issue.title, body: issue.body },
          "sync",
          { provider: target.provider, key: issue.key, url: issue.url },
          issue.labels,
        );
      } else {
        // A type that the person chose stays; detection fills or changes only its own.
        const detected =
          linked.typeSource === "user" || linked.typeSource === "agent"
            ? null
            : detectBoardTicketType({ labels: issue.labels ?? [], title: issue.title, body: issue.body });
        const retype = detected !== null && detected !== linked.type;
        if (retype) typeEvent(linked, detected, "sync");
        if (retype || linked.title !== issue.title || linked.body !== issue.body) {
          replace({
            ...linked,
            title: issue.title,
            body: issue.body,
            ...(retype ? { type: detected, typeSource: "detected" as const } : {}),
            updatedAt: now(),
          });
        }
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
      if (input.type !== undefined) typeEvent(current, input.type, "user");
      return replace({
        ...current,
        ...(input.title === undefined ? {} : { title: input.title.trim() || current.title }),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
        ...(input.type === undefined ? {} : { type: input.type, typeSource: "user" as const }),
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
  // Each team job has its own ticket and one for each role, moved with the rule of the desktop: only when
  // the column or the failure that the job asks for changes, and never out of Done unless the job runs.
  const teamAsked = new Map<string, string>();
  const teamFailure = (failure: BoardTicketTeamFailure) =>
    failure === "stopped"
      ? sourceText("error.agent.boardTickets.teamJobStopped")
      : sourceText("error.agent.boardTickets.teamJobNotDone");
  const applyTeamStep = (ticketId: string, key: string, step: BoardTicketTeamStep) => {
    const asked = `${step.status}/${step.failure ?? ""}`;
    if (teamAsked.get(key) === asked) return;
    teamAsked.set(key, asked);
    const ticket = tickets.find((candidate) => candidate.id === ticketId);
    if (!ticket || (ticket.status === "done" && step.status !== "running")) return;
    const error = step.failure === null ? null : teamFailure(step.failure);
    if (error !== ticket.error) replace({ ...ticket, error, updatedAt: now() });
    if (ticket.status !== step.status) moveTicket({ ticketId, status: step.status }, "agent");
  };
  const createTeamTicket = (
    input: CreateBoardTicketInput,
    links: Pick<BoardTicket, "teamJobId" | "teamRoleId" | "taskId" | "threadId">,
  ): BoardTicket => replace({ ...createTicket(input, "agent", null), ...links });
  followTeam?.((job) => {
    const title =
      job.brief
        .split("\n")
        .map((line) => line.replace(/\s+/gu, " ").trim())
        .find((line) => line.length > 0) ?? job.id;
    const own = tickets.filter((ticket) => ticket.teamJobId === job.id);
    const jobStep = boardTicketTeamJobStep(job);
    // An Autopilot job works on a ticket that is on the board already, as the desktop's follower adopts it.
    const decided = job.decision?.ticketId
      ? tickets.find((ticket) => ticket.id === job.decision?.ticketId && ticket.teamJobId === null)
      : undefined;
    const adopted = decided ? replace({ ...decided, teamJobId: job.id, updatedAt: now() }) : undefined;
    const jobTicket =
      own.find((ticket) => ticket.teamRoleId === null) ??
      adopted ??
      createTeamTicket(
        { title, body: job.brief, status: jobStep.status },
        { teamJobId: job.id, teamRoleId: null, taskId: null, threadId: null },
      );
    applyTeamStep(jobTicket.id, job.id, jobStep);
    for (const role of job.roles) {
      const key = `${job.id}/${role.roleId}`;
      const step = boardTicketTeamRoleStep(job, role);
      const existing = own.find((ticket) => ticket.teamRoleId === role.roleId);
      const ticket =
        existing ??
        createTeamTicket(
          {
            title: `${role.label}: ${title}`,
            status: step?.status ?? (role.state === "working" ? "running" : "needs_review"),
            agentId: role.agentId,
          },
          { teamJobId: job.id, teamRoleId: role.roleId, taskId: role.taskId, threadId: role.threadId },
        );
      if (existing && (existing.agentId !== role.agentId || existing.taskId !== role.taskId)) {
        replace({ ...existing, agentId: role.agentId, taskId: role.taskId, threadId: role.threadId, updatedAt: now() });
      }
      if (step) applyTeamStep(ticket.id, key, step);
      else teamAsked.delete(key);
    }
  });
  return api;
}
