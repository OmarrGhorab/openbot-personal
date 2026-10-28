// The ticket source of an agent, as the settings screen reads and writes it. The bridge calls live
// here, so the screen and the row only see this port.

import type { AgentTicketWatch, AgentTicketWatchInput } from "@openbot/contracts/ipc";

export interface TicketWatchPort {
  read(agentId: string): Promise<AgentTicketWatch | null>;
  save(input: AgentTicketWatchInput): Promise<AgentTicketWatch>;
  remove(agentId: string): Promise<void>;
}

export function agentTicketWatchPort(): TicketWatchPort {
  return {
    read: (agentId) => window.openbot.agent.ticketWatch(agentId),
    save: (input) => window.openbot.agent.setTicketWatch(input),
    remove: (agentId) => window.openbot.agent.clearTicketWatch(agentId),
  };
}
