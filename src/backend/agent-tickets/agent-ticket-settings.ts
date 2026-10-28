import type { AgentTicketWatch, AgentTicketWatchInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentTicketStore } from "./agent-ticket-store";
import { TicketWatchInvalid } from "./agent-ticket-watch";

export interface AgentTicketSettingsOptions {
  store: AgentTicketStore;
  /** Whether an agent with this ID exists. The watch belongs to an agent. */
  agentExists(agentId: string): boolean;
}

/**
 * The ticket source that the settings screen reads and writes. It checks the agent and the input
 * before it reaches the store, and it gives the user a catalog text rather than the validator's field
 * name. It never imports the agent service.
 */
export class AgentTicketSettings {
  readonly #options: AgentTicketSettingsOptions;

  constructor(options: AgentTicketSettingsOptions) {
    this.#options = options;
  }

  read(agentId: string): AgentTicketWatch | null {
    this.#requireAgent(agentId);
    return this.#options.store.watch(agentId);
  }

  write(input: AgentTicketWatchInput): AgentTicketWatch {
    this.#requireAgent(input.agentId);
    try {
      return this.#options.store.setWatch(
        input.agentId,
        { provider: input.provider, project: input.project, label: input.label },
        input.enabled,
      );
    } catch (error) {
      if (error instanceof TicketWatchInvalid) throw new Error(sourceText("error.backend.ticketWatchInvalid"));
      throw error;
    }
  }

  clear(agentId: string): void {
    this.#requireAgent(agentId);
    this.#options.store.removeWatch(agentId);
  }

  #requireAgent(agentId: string): void {
    if (!this.#options.agentExists(agentId)) throw new Error(sourceText("error.agent.unknown", { id: agentId }));
  }
}
