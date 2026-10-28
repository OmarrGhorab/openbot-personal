import { AGENT_TICKET_PROVIDERS, type AgentTicketWatch } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

/** Decodes the ticket watch that main sends, or null when the agent has none. */
export function decodeAgentTicketWatchOrNull(value: unknown): AgentTicketWatch | null {
  if (value === null) return null;
  return decodeAgentTicketWatch(value);
}

/** Decodes one ticket watch from main. A value of another shape is a bug on the main side, so it throws. */
export function decodeAgentTicketWatch(value: unknown): AgentTicketWatch {
  if (!isDynamicRecord(value)) throw new Error("Invalid ticket watch from main.");
  const { agentId, provider, project, label, enabled, createdAt, updatedAt } = value;
  if (
    !isString(agentId) ||
    !isOneOf(AGENT_TICKET_PROVIDERS, provider) ||
    !isString(project) ||
    !isString(label) ||
    !isBoolean(enabled) ||
    !isString(createdAt) ||
    !isString(updatedAt)
  ) {
    throw new Error("Invalid ticket watch from main.");
  }
  return { agentId, provider, project, label, enabled, createdAt, updatedAt };
}
