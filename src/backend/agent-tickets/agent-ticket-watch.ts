import { Schema } from "effect";

/** The ticket systems that an agent can watch. Only the first one has an intake today. */
export const TICKET_PROVIDERS = ["github", "linear", "jira"] as const;
export type TicketProvider = (typeof TICKET_PROVIDERS)[number];

const TICKET_LABEL_MAX_LENGTH = 100;
const GITHUB_PROJECT_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;

/** The source of tickets of one agent (`projection_agent_ticket_watches`). */
export interface AgentTicketWatch {
  agentId: string;
  provider: TicketProvider;
  /** For GitHub, the `owner/repo` of the repository. */
  project: string;
  /** Only tickets that carry this label start a work thread. */
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTicketWatchInput {
  provider: TicketProvider;
  project: string;
  label: string;
}

/** Carries the field that failed, never the value. */
export class TicketWatchInvalid extends Schema.TaggedError<TicketWatchInvalid>()("TicketWatchInvalid", {
  field: Schema.Literals(["provider", "project", "label"]),
}) {}

/**
 * Checks and trims a watch that the editor or a Team API client sent. The project must match the
 * provider's name syntax, so a typo never reaches the ticket API as a different repository.
 */
export function validateTicketWatchInput(input: AgentTicketWatchInput): AgentTicketWatchInput {
  if (!TICKET_PROVIDERS.includes(input.provider)) throw new TicketWatchInvalid({ field: "provider" });
  const project = input.project.trim();
  if (input.provider === "github" && !GITHUB_PROJECT_PATTERN.test(project))
    throw new TicketWatchInvalid({ field: "project" });
  if (project.length === 0 || project.length > 300) throw new TicketWatchInvalid({ field: "project" });
  const label = input.label.trim();
  if (label.length === 0 || label.length > TICKET_LABEL_MAX_LENGTH) throw new TicketWatchInvalid({ field: "label" });
  return { provider: input.provider, project, label };
}
