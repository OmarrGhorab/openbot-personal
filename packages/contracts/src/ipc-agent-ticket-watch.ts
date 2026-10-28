// The ticket source of an agent: the repository and label that the ticket intake watches. Only GitHub
// is polled in this version; the other providers are accepted and stored.

export const AGENT_TICKET_PROVIDERS = ["github", "linear", "jira"] as const;
export type AgentTicketProvider = (typeof AGENT_TICKET_PROVIDERS)[number];

export const AGENT_TICKET_LABEL_MAX_LENGTH = 100;

export interface AgentTicketWatch {
  agentId: string;
  provider: AgentTicketProvider;
  /** For GitHub, the `owner/repo` of the repository. */
  project: string;
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTicketWatchInput {
  agentId: string;
  provider: AgentTicketProvider;
  project: string;
  label: string;
  enabled: boolean;
}
