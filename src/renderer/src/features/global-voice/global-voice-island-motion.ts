import { springKeyframes } from "@openbot/ui/spring-motion";

/** A spring of 400 ms with a small overshoot. One response is the whole animation. */
export const GLOBAL_VOICE_ISLAND_SPRING = { response: 0.4, dampingFraction: 0.68 } as const;

export const GLOBAL_VOICE_ISLAND = {
  notch: { width: 180, height: 32 },
  pill: { width: 340, height: 108 },
  picker: { width: 400, height: 380 },
} as const;

export interface IslandSize {
  width: number;
  height: number;
}

/**
 * Scale keyframes from one island size to the next. The element is already the target size, so the
 * animation only changes transform and opacity. Reduced motion fades, with no scale.
 */
export function islandScaleKeyframes(from: IslandSize, to: IslandSize, reducedMotion: boolean): Keyframe[] {
  if (reducedMotion || to.width <= 0 || to.height <= 0) {
    return [
      { opacity: 0, transform: "none" },
      { opacity: 1, transform: "none" },
    ];
  }
  const scaleX = from.width / to.width;
  const scaleY = from.height / to.height;
  return springKeyframes(GLOBAL_VOICE_ISLAND_SPRING, (progress) => ({
    opacity: Math.min(1, progress * 3),
    transform: `scale(${scaleX + (1 - scaleX) * progress}, ${scaleY + (1 - scaleY) * progress})`,
  }));
}

/** `rtl` when the text is mostly Arabic, so a name stays right to left in an English island. */
export function globalVoiceTextDirection(value: string): "rtl" | "ltr" {
  const arabic = value.match(/\p{Script=Arabic}/gu)?.length ?? 0;
  const latin = value.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return arabic > latin ? "rtl" : "ltr";
}
