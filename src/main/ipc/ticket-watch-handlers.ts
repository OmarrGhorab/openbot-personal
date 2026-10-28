// The ticket source of each agent: the repository and the label that the ticket intake watches.
import type { AgentTicketSettings } from "../../backend/agent-tickets/agent-ticket-settings";
import { parseAgentId } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseTicketWatchInput } from "./ticket-watch-inputs";

interface TicketWatchIpcDependencies {
  settings: AgentTicketSettings;
}

export function ticketWatchIpcHandlers({
  settings,
}: TicketWatchIpcDependencies): Pick<IpcGroupHandlers, "agentTicketWatch"> {
  return {
    agentTicketWatch: {
      ticketWatch: payloadHandler(parseAgentId, (agentId) => settings.read(agentId)),
      setTicketWatch: payloadHandler(parseTicketWatchInput, (input) => settings.write(input)),
      clearTicketWatch: payloadHandler(parseAgentId, (agentId) => settings.clear(agentId)),
    },
  };
}
