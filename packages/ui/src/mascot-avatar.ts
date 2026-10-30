import { parseAgentMascotSeed } from "@openbot/contracts/agent-mascot-avatar";
import type { AppLogoColor, AppLogoShape } from "@openbot/contracts/app-logo-color";

// The 80 px pictures of the App icon mascots (`build/mascots`), one for each shape and color. The
// Settings App icon picker and the agent mascot avatars draw the same files.
const MASCOT_PICTURES: Record<string, string> = import.meta.glob("./assets/mascots/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The picture of a mascot in a logo color. */
export function mascotImageUrl(shape: AppLogoShape, color: AppLogoColor): string {
  return MASCOT_PICTURES[`./assets/mascots/${shape}-${color}.png`] ?? "";
}

/** The mascot picture an avatar seed names, or null for a generated shape seed. */
export function mascotAvatarImageUrl(seed: string | null | undefined): string | null {
  const mascot = parseAgentMascotSeed(seed);
  if (!mascot) return null;
  return mascotImageUrl(mascot.shape, mascot.color) || null;
}
