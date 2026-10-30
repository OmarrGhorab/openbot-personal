import { type AppLogoColor, type AppLogoShape, isAppLogoColor, isAppLogoShape } from "./app-logo-color";

/**
 * A mascot avatar: one of the App icon mascots (`build/mascots`) in one of the logo colors.
 *
 * It is saved in the agent's existing `avatarSeed` as `mascot:<shape>:<color>`, so no column, IPC
 * field or Team API field changes. The seed pattern (`[a-z0-9:-]`) already accepts it, so the value
 * survives a restart, a provider switch, an export and a remote host as it is. A client that does not
 * know mascots draws a generated shape from the same seed. Shapes and colors are saved as written:
 * add one, never rename one.
 */
export interface AgentMascotAvatar {
  shape: AppLogoShape;
  color: AppLogoColor;
}

const AGENT_MASCOT_SEED_PREFIX = "mascot:";

export function agentMascotSeed(mascot: AgentMascotAvatar): string {
  return `${AGENT_MASCOT_SEED_PREFIX}${mascot.shape}:${mascot.color}`;
}

/** The mascot a seed names, or null for a generated shape seed. An unknown mascot is a shape seed. */
export function parseAgentMascotSeed(seed: string | null | undefined): AgentMascotAvatar | null {
  if (!seed?.startsWith(AGENT_MASCOT_SEED_PREFIX)) return null;
  const [shape, color, ...rest] = seed.slice(AGENT_MASCOT_SEED_PREFIX.length).split(":");
  if (rest.length > 0 || !isAppLogoShape(shape) || !isAppLogoColor(color)) return null;
  return { shape, color };
}
