import type { AgentTasksSnapshot, BoardTicket } from "@openbot/contracts/ipc";

/**
 * ticket 255: the thread that did a ticket's work. The task may belong to another agent than the
 * ticket's (a reassign keeps the old run), so the owner is found by the task id, then the thread id.
 * Null task: a ticket taken in a chat (#263), whose thread is the agent's own chat.
 */
export function ticketThreadTarget(
  ticket: Pick<BoardTicket, "agentId" | "taskId" | "threadId">,
  snapshots: Readonly<Record<string, AgentTasksSnapshot>>,
): { agentId: string; taskId: string | null } | null {
  for (const snapshot of Object.values(snapshots)) {
    const task = snapshot.tasks.find(
      (candidate) =>
        (ticket.taskId !== null && candidate.id === ticket.taskId) ||
        (ticket.threadId !== null && candidate.threadId === ticket.threadId),
    );
    if (task) return { agentId: snapshot.agentId, taskId: task.id };
  }
  if (!ticket.agentId) return null;
  return { agentId: ticket.agentId, taskId: ticket.taskId };
}
