// The order of the agents an `@` mention suggests, on desktop, the web client and the phone app.

export interface MentionableAgent {
  name: string;
  title: string;
  description: string;
}

/** Lower case, without diacritics, so `e` finds `é`. */
function foldMentionText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/**
 * How well an agent answers the query, lower first; null when it does not. A hit in the name
 * outranks one in the title, and the title outranks the description, so the agent the user names
 * is at the top. The same steps as the skill rank in the composer picker.
 */
export function agentMentionRank(agent: MentionableAgent, query: string): number | null {
  const folded = foldMentionText(query.trim());
  if (!folded) return 0;
  const name = foldMentionText(agent.name);
  if (name === folded) return 0;
  if (name.startsWith(folded)) return 1;
  if (name.split(/[\s\-_]+/u).some((word) => word.startsWith(folded))) return 2;
  if (name.includes(folded)) return 3;
  const title = foldMentionText(agent.title);
  if (title.includes(folded)) return 4;
  const description = foldMentionText(agent.description);
  if (description.includes(folded)) return 5;
  // A query can run across fields, such as `alice eng` for Alice the engineer.
  return `${name} ${title} ${description}`.includes(folded) ? 6 : null;
}

/** The agents that match, best first. Agents of one rank keep their input order. */
export function rankAgentMentions<T extends MentionableAgent>(agents: readonly T[], query: string): T[] {
  const ranked = agents.flatMap((agent) => {
    const rank = agentMentionRank(agent, query);
    return rank === null ? [] : [{ agent, rank }];
  });
  // Array sort is stable.
  ranked.sort((left, right) => left.rank - right.rank);
  return ranked.map(({ agent }) => agent);
}

export type AgentNameMatch<T> =
  | { kind: "exact"; agent: T }
  | { kind: "single"; agent: T }
  | { kind: "ambiguous"; agents: T[] }
  | { kind: "none" };

/**
 * Which agent a typed name means. An exact name wins over every partial one, so "Reviewer"
 * finds Reviewer even when "Raven Reviewer" exists. Several partial matches and no exact one
 * are ambiguous: the caller asks the person which agent they meant instead of guessing.
 */
export function matchAgentName<T extends { name: string }>(agents: readonly T[], query: string): AgentNameMatch<T> {
  const folded = foldMentionText(query.trim().replace(/^@/u, ""));
  if (!folded) return { kind: "none" };
  const exact = agents.filter((agent) => foldMentionText(agent.name.trim()) === folded);
  if (exact.length === 1 && exact[0]) return { kind: "exact", agent: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", agents: exact };
  const partial = agents.filter((agent) => foldMentionText(agent.name).includes(folded));
  if (partial.length === 1 && partial[0]) return { kind: "single", agent: partial[0] };
  return partial.length > 1 ? { kind: "ambiguous", agents: partial } : { kind: "none" };
}
