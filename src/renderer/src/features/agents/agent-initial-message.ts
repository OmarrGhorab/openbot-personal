import type { FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";

/**
 * The first message a newly created agent gets. The purpose is saved as the agent's description,
 * which its instructions carry on every turn, so it is not posted as a user message (ticket 259):
 * the chat opens with a short greeting either way.
 */
export function createAgentInitialMessage(_draft: Pick<FirstAgentDraft, "purpose">): string {
  return "Greet me briefly.";
}
