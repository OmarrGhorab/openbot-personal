import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";

/** The face an agent conversation takes its colour from. */
export interface AgentAccentSource {
  avatarSeed?: string | undefined;
  avatarHue?: AvatarHue | null | undefined;
}

/** Which of the two accent text tokens reads on the accent: light text, or dark text. */
export type AgentAccentTone = "light" | "dark";

/** The colour and text tone the user's bubbles and the send button take in one agent's chat. */
export interface AgentAccent {
  color: string;
  tone: AgentAccentTone;
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(hex.trim());
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => channel(Number.parseInt(part ?? "0", 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG contrast ratio of two luminances. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The dark text token is near #141414. */
const DARK_TEXT_LUMINANCE = relativeLuminance("#141414");

/**
 * Light text on a saturated colour, as a chat app does, unless dark text reads clearly better:
 * light text is kept while it reaches 3:1 (large, bold-ish bubble text) or still beats dark text.
 */
export function agentAccentTone(hex: string): AgentAccentTone {
  const luminance = relativeLuminance(hex);
  const light = contrastRatio(1, luminance);
  const dark = contrastRatio(DARK_TEXT_LUMINANCE, luminance);
  return light >= 3 || light >= dark ? "light" : "dark";
}

/** The accent of a single agent's chat, or none (a channel, or no agent yet), which keeps the neutral look. */
export function agentAccent(agent: AgentAccentSource | undefined): AgentAccent | undefined {
  const seed = agent?.avatarSeed;
  if (!seed) return undefined;
  const color = avatarHeadColor(seed, agent?.avatarHue ?? null);
  return { color, tone: agentAccentTone(color) };
}

/**
 * The custom property a conversation root sets. The value is the agent's own head colour, read at
 * runtime through the avatar helper, so the stylesheet holds no colour literal.
 */
export function agentAccentStyle(accent: AgentAccent | undefined): string {
  return accent ? `--agent-accent: ${accent.color};` : "";
}
