import type { AgentTaskPullRegistry } from "../agent-tasks/agent-tasks";
import type { AgentTicketStore } from "./agent-ticket-store";

/**
 * Gives a pull request to the work thread that started the ticket. It is the answer to the agent's
 * `register_pull_request` tool. It only accepts a work thread that the intake started from a ticket.
 */
export class TicketPullRegistry implements AgentTaskPullRegistry {
  readonly #store: AgentTicketStore;

  constructor(store: AgentTicketStore) {
    this.#store = store;
  }

  registerForTask(taskId: string, project: string, pullNumber: number) {
    const ticket = this.#store.ticketForTask(taskId);
    if (!ticket) return "not-a-ticket-task" as const;
    const registered = this.#store.ownPull({
      agentId: ticket.agentId,
      taskId,
      provider: ticket.provider,
      project,
      pullNumber,
      ticketKey: ticket.ticketKey,
    });
    return registered ? ("registered" as const) : ("owned-by-another" as const);
  }
}
