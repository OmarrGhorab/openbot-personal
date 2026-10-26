import type { GlobalVoicePickerAgent } from "@openbot/contracts/ipc";

/** The agents whose name or title contains the query, ignoring case. An empty query keeps them all. */
export function filterGlobalVoiceAgents(
  agents: readonly GlobalVoicePickerAgent[],
  query: string,
): GlobalVoicePickerAgent[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...agents];
  return agents.filter(
    (agent) => agent.name.toLocaleLowerCase().includes(needle) || agent.title.toLocaleLowerCase().includes(needle),
  );
}

/** Moves the highlight by one row and wraps at both ends. An empty list has no highlight. */
export function moveGlobalVoiceHighlight(index: number, count: number, step: 1 | -1): number {
  if (count <= 0) return -1;
  const current = index < 0 || index >= count ? (step === 1 ? -1 : 0) : index;
  return (current + step + count) % count;
}

/**
 * The row a number key chooses: 1 to 9 for the first nine rows. Digits take the place of the search
 * text only while the search is empty, so a name with a digit can still be typed.
 */
export function globalVoiceNumberKeyIndex(key: string, query: string, count: number): number | null {
  if (query.length > 0 || !/^[1-9]$/.test(key)) return null;
  const index = Number(key) - 1;
  return index < count ? index : null;
}

/** Initials for the avatar of an agent, from its name. The name is never empty for a saved agent. */
export function globalVoiceInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toLocaleUpperCase() || "?";
}

/**
 * Whether a pointer is over the drawn island. The window is larger than the island, and only the
 * island takes clicks; a missing island takes none.
 */
export function pointInRect(
  rect: { left: number; right: number; top: number; bottom: number } | undefined,
  x: number,
  y: number,
): boolean {
  return rect ? x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom : false;
}

/** Whether the agent has its own avatar to draw. Without a seed or an image the picker shows its initials. */
export function globalVoiceHasAvatar(agent: Pick<GlobalVoicePickerAgent, "avatarSeed" | "avatarUrl">): boolean {
  return agent.avatarSeed.trim() !== "" || (agent.avatarUrl ?? "").trim() !== "";
}

/** A step of the voice flow that did not finish in time. The window shows its error and gets back to idle. */
export class GlobalVoiceTimeout extends Error {
  constructor() {
    super("The global voice step timed out.");
  }
}

/**
 * Rejects with `GlobalVoiceTimeout` when `work` has not settled within `ms`. The work itself keeps
 * running; the caller decides what a late result means. A step that never settles must not hold the
 * window in its phase.
 */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GlobalVoiceTimeout()), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
