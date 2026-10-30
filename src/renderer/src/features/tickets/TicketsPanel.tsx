import type {
  AgentTask,
  AgentTasksSnapshot,
  BoardTicket,
  BoardTicketEvent,
  BoardTicketSyncState,
  RavenAutopilotDecision,
  RavenTeamJob,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { TicketsPage } from "@openbot/ui/features/tickets/TicketsPage";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { appPort } from "../../app-port";
import { useNavigation } from "../../navigation";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { agentTasksPort } from "../agent-tasks/agent-tasks-port";
import { useAgents } from "../agents/agents-context";
import { serverCanAdminister } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { useUsage } from "../usage/usage-context";

export interface TicketsPanelProps {
  serverId: string;
  hostName: string;
  onBack?: (() => void) | undefined;
  agentsOpen?: boolean | undefined;
  onToggleAgents?: (() => void) | undefined;
}

/** How often the page reads the board of a joined server again. A joined server sends no change event here. */
const REMOTE_REFRESH_MS = 10_000;

/** The text that the team page starts with for a ticket: its title, its text and the link of its issue. */
function teamBrief(ticket: BoardTicket | null): string | undefined {
  if (!ticket) return undefined;
  return [ticket.title, ticket.body, ticket.external?.url].filter((part) => part && part.trim() !== "").join("\n\n");
}

/** Read on each call: stories replace `window.openbot` per case. */
function boardTickets() {
  return window.openbot.boardTickets;
}

/**
 * The Tickets page on desktop. The board of this computer lives in its database: the page reads it
 * again when main says it changed and never polls. A joined server serves its own board through
 * `board-tickets-v1` to an owner or admin: the page reads it after each change, when the window gets
 * focus, and every few seconds while it shows. Any other joined server shows a notice and gets no call.
 * The work threads of each agent and the sync with a ticket system are on this computer only.
 */
export function TicketsPanel(props: TicketsPanelProps) {
  const { agentList } = useAgents();
  const { servers } = useServers();
  const agentTasks = useAgentTasks();
  const { selectAgent } = useNavigation();
  const { openTeam } = useUsage();
  const server = () => servers().find((item) => item.id === props.serverId);
  const local = () => server()?.kind === "local";
  const available = () => {
    const current = server();
    return (
      current?.kind === "local" || (current?.kind === "remote" && serverCanAdminister(current, "board-tickets-v1"))
    );
  };
  const [tickets, setTickets] = createSignal<BoardTicket[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [selectedTicketId, setSelectedTicketId] = createSignal<string | null>(null);
  const [events, setEvents] = createSignal<BoardTicketEvent[] | null>(null);
  /** The sync with a connected ticket system. Main sends it again when a connection or the target changes. */
  const [syncState, setSyncState] = createSignal<BoardTicketSyncState | null>(null);
  /** The thread list of each agent that this page read. The task state wins once it has one. */
  const [listed, setListed] = createStore<Record<string, AgentTasksSnapshot>>({});
  /** The team jobs of this computer, for the Autopilot decision on a job's ticket. */
  const [teamJobs, setTeamJobs] = createSignal<RavenTeamJob[]>([]);
  let disposed = false;
  let listRequest = 0;
  let eventsRequest = 0;
  onCleanup(() => {
    disposed = true;
  });

  function fail(error: unknown, fallback: AppTextKey): void {
    if (disposed) return;
    const { t, errorMessage } = currentText();
    actionToast.error(errorMessage(error, t(fallback)));
  }

  function loadTickets(): void {
    listRequest += 1;
    const request = listRequest;
    boardTickets()
      .list(props.serverId)
      .then((list) => {
        if (disposed || request !== listRequest) return;
        setTickets(list);
        setLoaded(true);
      })
      .catch((error) => {
        if (request === listRequest) fail(error, "tickets.error.load");
      });
  }

  function loadEvents(ticketId: string): void {
    eventsRequest += 1;
    const request = eventsRequest;
    boardTickets()
      .events(ticketId, props.serverId)
      .then((list) => {
        if (!disposed && request === eventsRequest) setEvents(list);
      })
      .catch((error) => {
        if (request === eventsRequest) fail(error, "tickets.error.activity");
      });
  }

  /** A joined server sends no change event here, so the page reads its board after each change. */
  function changedOnServer(ticketId?: string): void {
    if (local() || disposed) return;
    loadTickets();
    if (ticketId && selectedTicketId() === ticketId) loadEvents(ticketId);
  }

  function loadSync(): void {
    boardTickets()
      .syncState()
      .then((state) => {
        if (!disposed) setSyncState(state);
      })
      .catch((error) => fail(error, "tickets.error.sync"));
  }

  async function syncAction(action: () => Promise<BoardTicketSyncState>): Promise<boolean> {
    try {
      const state = await action();
      if (!disposed) setSyncState(state);
      return true;
    } catch (error) {
      fail(error, "tickets.error.sync");
      return false;
    }
  }

  function loadThreads(agentId: string): void {
    agentTasksPort()
      .agent.listTasks(agentId)
      .then((snapshot) => {
        if (disposed) return;
        setListed((current) => {
          current[agentId] = snapshot;
        });
      })
      .catch((error) => fail(error, "conversation.tasks.error.load"));
  }

  createEffect(available, (on) => {
    if (!on) return;
    loadTickets();
    if (!local()) {
      const refresh = () => {
        loadTickets();
        const open = selectedTicketId();
        if (open) loadEvents(open);
      };
      const timer = setInterval(refresh, REMOTE_REFRESH_MS);
      window.addEventListener("focus", refresh);
      return () => {
        clearInterval(timer);
        window.removeEventListener("focus", refresh);
      };
    }
    loadSync();
    const stopTickets = boardTickets().onChanged((change) => {
      loadTickets();
      const open = selectedTicketId();
      if (open && change.ticketIds.includes(open)) loadEvents(open);
    });
    const stopSync = boardTickets().onSyncChanged((state) => setSyncState(state));
    return () => {
      stopTickets();
      stopSync();
    };
  });

  /** Team jobs run on this computer only, so a joined server's board shows no decision. */
  createEffect(
    () => available() && local(),
    (on) => {
      if (!on) return;
      const loadJobs = () => {
        window.openbot.ravenTeam
          .listJobs()
          .then((jobs) => {
            if (!disposed) setTeamJobs(jobs);
          })
          .catch(() => {
            // The board works without decisions; the Raven team page reports its own errors.
          });
      };
      loadJobs();
      return window.openbot.ravenTeam.onChanged(loadJobs);
    },
  );
  const decisions = createMemo(() => {
    const byJob: Record<string, RavenAutopilotDecision> = {};
    for (const job of teamJobs()) if (job.decision) byJob[job.id] = job.decision;
    return byJob;
  });

  createEffect(
    () => (available() && local() ? agentList().map((agent) => agent.id) : []),
    (agentIds) => {
      for (const agentId of agentIds) if (!listed[agentId]) loadThreads(agentId);
    },
  );

  createEffect(selectedTicketId, (ticketId) => {
    setEvents(null);
    if (ticketId) loadEvents(ticketId);
  });

  const snapshots = createMemo(() => {
    const merged: Record<string, AgentTasksSnapshot> = {};
    for (const agent of agentList()) {
      const snapshot = agentTasks.snapshot(agent.id) ?? listed[agent.id];
      if (snapshot) merged[agent.id] = snapshot;
    }
    return merged;
  });
  const selectedTicket = () => tickets().find((ticket) => ticket.id === selectedTicketId());
  /** The work thread of the open ticket. Equal while the agent and the task stay, so its messages load once. */
  const openThread = createMemo(
    () => {
      const ticket = selectedTicket();
      return ticket?.agentId && ticket.taskId ? { agentId: ticket.agentId, taskId: ticket.taskId } : null;
    },
    { equals: (left, right) => left?.agentId === right?.agentId && left?.taskId === right?.taskId },
  );
  createEffect(openThread, (thread) => {
    if (thread) agentTasks.openTask(thread.agentId, thread.taskId);
  });
  const messages = () => {
    const thread = openThread();
    return thread ? (agentTasks.conversation(thread.taskId)?.messages ?? []) : [];
  };

  function threadAction(thread: AgentTask, action: (input: { agentId: string; taskId: string }) => Promise<void>) {
    action({ agentId: thread.agentId, taskId: thread.id }).catch((error) => fail(error, "tickets.error.thread"));
  }

  return (
    <TicketsPage
      onOpenTeam={local() ? (ticket) => openTeam(props.serverId, null, undefined, teamBrief(ticket)) : undefined}
      available={available()}
      loaded={loaded()}
      hostName={props.hostName}
      onBack={props.onBack}
      agentsOpen={props.agentsOpen}
      onToggleAgents={props.onToggleAgents}
      agents={agentList()}
      tickets={tickets()}
      snapshots={snapshots()}
      selectedTicketId={selectedTicketId()}
      decisions={decisions()}
      onSelectTicket={setSelectedTicketId}
      events={events()}
      messages={messages()}
      onCreate={async (ticket) => {
        try {
          await boardTickets().create(ticket, props.serverId);
          changedOnServer();
          return true;
        } catch (error) {
          fail(error, "tickets.error.create");
          return false;
        }
      }}
      onStart={async (start) => {
        try {
          await boardTickets().start(start, props.serverId);
          if (local()) loadThreads(start.agentId);
          changedOnServer(start.ticketId);
          return true;
        } catch (error) {
          fail(error, "tickets.error.start");
          return false;
        }
      }}
      onMove={(ticketId, status) => {
        boardTickets()
          .move({ ticketId, status }, props.serverId)
          .then(() => changedOnServer(ticketId))
          .catch((error) => fail(error, "tickets.error.move"));
      }}
      onAssign={(ticketId, agentId) => {
        boardTickets()
          .update({ ticketId, agentId }, props.serverId)
          .then(() => changedOnServer(ticketId))
          .catch((error) => fail(error, "tickets.error.assign"));
      }}
      // The board-tickets-v1 wire of a joined server carries no type, so only this computer's board sets one.
      onSetType={
        local()
          ? (ticketId, type) => {
              boardTickets()
                .update({ ticketId, type }, props.serverId)
                .then(() => changedOnServer(ticketId))
                .catch((error) => fail(error, "tickets.error.type"));
            }
          : undefined
      }
      onDelete={(ticketId) => {
        boardTickets()
          .delete(ticketId, props.serverId)
          .then(() => {
            if (selectedTicketId() === ticketId) setSelectedTicketId(null);
            changedOnServer();
          })
          .catch((error) => fail(error, "tickets.error.delete"));
      }}
      onOpenThread={(ticket) => {
        const { agentId, taskId } = ticket;
        if (!agentId || !taskId) return;
        selectAgent(agentId);
        agentTasks.requestOpenTask(agentId, taskId);
      }}
      onOpenLink={(url) => void appPort().openUrl(url)}
      // The message goes to the work thread first; the activity keeps a copy as a comment.
      onSteer={async (ticket, text) => {
        if (!ticket.agentId || !ticket.taskId) return false;
        if (!(await agentTasks.sendToTask(ticket.agentId, ticket.taskId, text))) return false;
        try {
          await boardTickets().comment({ ticketId: ticket.id, text }, props.serverId);
          changedOnServer(ticket.id);
        } catch (error) {
          fail(error, "tickets.error.steer");
        }
        return true;
      }}
      // `newTicketAutopilot` stays out until the Autopilot settings of #195 (`window.openbot.ravenAutopilot`) are on
      // main: the New ticket dialog then shows "Let autopilot work on it" while its switch is on.
      // Approve moves the ticket to Done. The Reviewer merge (auto-merge on for the type) hooks in here.
      onApprove={(ticket) => {
        boardTickets()
          .move({ ticketId: ticket.id, status: "done" }, props.serverId)
          .then(() => changedOnServer(ticket.id))
          .catch((error) => fail(error, "tickets.error.move"));
      }}
      // Request changes sends the comment to the work thread, keeps a copy in the activity and moves the
      // ticket back to Running. The thread's next turn then moves it on as usual.
      onRequestChanges={async (ticket, text) => {
        if (!ticket.agentId || !ticket.taskId) return false;
        if (!(await agentTasks.sendToTask(ticket.agentId, ticket.taskId, text))) return false;
        try {
          await boardTickets().comment({ ticketId: ticket.id, text }, props.serverId);
          await boardTickets().move({ ticketId: ticket.id, status: "running" }, props.serverId);
          changedOnServer(ticket.id);
        } catch (error) {
          fail(error, "tickets.error.requestChanges");
        }
        return true;
      }}
      // The sync with a ticket system uses the connections of this computer, so a joined server has none.
      sync={
        local()
          ? {
              state: syncState(),
              onLoadProjects: async (provider) => {
                try {
                  return await boardTickets().syncProjects(provider);
                } catch (error) {
                  fail(error, "tickets.error.syncProjects");
                  return null;
                }
              },
              onSetTarget: (target) => syncAction(() => boardTickets().setSyncTarget(target)),
              onSyncNow: () => syncAction(() => boardTickets().syncNow()),
            }
          : undefined
      }
      onStopThread={(thread) => threadAction(thread, (input) => agentTasksPort().agent.stopTask(input))}
      onPauseThread={(thread) => threadAction(thread, (input) => agentTasksPort().agent.pauseTask(input))}
      onResumeThread={(thread) => threadAction(thread, (input) => agentTasksPort().agent.resumeTask(input))}
    />
  );
}
