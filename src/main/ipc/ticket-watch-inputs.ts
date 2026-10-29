import {
  AGENT_TICKET_LABEL_MAX_LENGTH,
  AGENT_TICKET_PROVIDERS,
  type AgentTicketWatchInput,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

/** Decodes the settings of a ticket watch from the renderer. The store validates the project and label again. */
export function parseTicketWatchInput(value: unknown): AgentTicketWatchInput {
  if (!isObject(value)) throw new Error("The ticket watch is required.");
  const provider = value.provider;
  if (!isOneOf(AGENT_TICKET_PROVIDERS, provider)) throw new Error("provider is not a ticket system.");
  if (typeof value.enabled !== "boolean") throw new Error("enabled must be a boolean.");
  return {
    agentId: requireString(value.agentId, "agentId"),
    provider,
    project: requireString(value.project, "project", 300),
    label: requireString(value.label, "label", AGENT_TICKET_LABEL_MAX_LENGTH),
    enabled: value.enabled,
  };
}
