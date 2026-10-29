import type { AgentTask, AgentTasksSnapshot, BoardTicket, BoardTicketEvent } from "@openbot/contracts/ipc";
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
import { useServers } from "../servers/servers-context";

export interface TicketsPanelProps {
  serverId: string;
  hostName: string;
  onBack?: (() => void) | undefined;
  agentsOpen?: boolean | undefined;
  onToggleAgents?: (() => void) | undefined;
}

/** Read on each call: stories replace `window.openbot` per case. */
function boardTickets() {
  return window.openbot.boardTickets;
}

/**
 * The Tickets page on desktop. The board lives on this computer, so a joined server shows a notice and
 * makes no call. The page reads the board again when main says it changed; it never polls. The work
 * threads of each agent come from the task state, which the agent events keep current.
 */
export function TicketsPanel(props: TicketsPanelProps) {
  const { agentList } = useAgents();
  const { servers } = useServers();
  const agentTasks = useAgentTasks();
  const { selectAgent } = useNavigation();
  const available = () => servers().some((server) => server.id === props.serverId && server.kind === "local");
  const [tickets, setTickets] = createSignal<BoardTicket[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [selectedTicketId, setSelectedTicketId] = createSignal<string | null>(null);
  const [events, setEvents] = createSignal<BoardTicketEvent[] | null>(null);
  /** The thread list of each agent that this page read. The task state wins once it has one. */
  const [listed, setListed] = createStore<Record<string, AgentTasksSnapshot>>({});
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
      .list()
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
      .events(ticketId)
      .then((list) => {
        if (!disposed && request === eventsRequest) setEvents(list);
      })
      .catch((error) => {
        if (request === eventsRequest) fail(error, "tickets.error.activity");
      });
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

  createEffect(available, (local) => {
    if (!local) return;
    loadTickets();
    return boardTickets().onChanged((change) => {
      loadTickets();
      const open = selectedTicketId();
      if (open && change.ticketIds.includes(open)) loadEvents(open);
    });
  });

  createEffect(
    () => (available() ? agentList().map((agent) => agent.id) : []),
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
      onSelectTicket={setSelectedTicketId}
      events={events()}
      messages={messages()}
      onCreate={async (ticket) => {
        try {
          await boardTickets().create(ticket);
          return true;
        } catch (error) {
          fail(error, "tickets.error.create");
          return false;
        }
      }}
      onStart={async (start) => {
        try {
          await boardTickets().start(start);
          loadThreads(start.agentId);
          return true;
        } catch (error) {
          fail(error, "tickets.error.start");
          return false;
        }
      }}
      onMove={(ticketId, status) => {
        boardTickets()
          .move({ ticketId, status })
          .catch((error) => fail(error, "tickets.error.move"));
      }}
      onAssign={(ticketId, agentId) => {
        boardTickets()
          .update({ ticketId, agentId })
          .catch((error) => fail(error, "tickets.error.assign"));
      }}
      onDelete={(ticketId) => {
        boardTickets()
          .delete(ticketId)
          .then(() => {
            if (selectedTicketId() === ticketId) setSelectedTicketId(null);
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
          await boardTickets().comment({ ticketId: ticket.id, text });
        } catch (error) {
          fail(error, "tickets.error.steer");
        }
        return true;
      }}
      onStopThread={(thread) => threadAction(thread, (input) => agentTasksPort().agent.stopTask(input))}
      onPauseThread={(thread) => threadAction(thread, (input) => agentTasksPort().agent.pauseTask(input))}
      onResumeThread={(thread) => threadAction(thread, (input) => agentTasksPort().agent.resumeTask(input))}
    />
  );
}
