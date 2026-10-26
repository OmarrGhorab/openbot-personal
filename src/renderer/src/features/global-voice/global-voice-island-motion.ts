import { springProgress } from "@openbot/ui/spring-motion";

/** A spring of about 300 ms with a small overshoot, like the Dynamic Island. */
/** One spring for width, height and corner radius: about 0.8 damping, settled in about 450 ms. */
export const GLOBAL_VOICE_ISLAND_SPRING = { response: 0.4, dampingFraction: 0.8 } as const;
/** How long the morph runs. The spring is within half a percent of rest by then. */
export const GLOBAL_VOICE_ISLAND_MORPH_MS = 450;

export const GLOBAL_VOICE_ISLAND = {
  notch: { width: 180, height: 32 },
  pill: { width: 420, height: 88 },
  review: { width: 420, height: 210 },
  picker: { width: 420, height: 222 },
} as const;

/** The picker shows at most this many rows. More agents scroll inside the island. */
export const GLOBAL_VOICE_PICKER_ROWS = 3;
/** Matches `--voice-row` in global-voice.css. */
export const GLOBAL_VOICE_PICKER_ROW = 48;
/** The search field, the hint line and the padding around them, in pixels. */
const PICKER_CHROME = 78;
/** The corner radius of the open island, like the Dynamic Island. */
export const GLOBAL_VOICE_ISLAND_RADIUS = 30;

export interface IslandSize {
  width: number;
  height: number;
}

/** The picker height fits its rows, from one to `GLOBAL_VOICE_PICKER_ROWS`, so no empty space shows. */
export function globalVoicePickerSize(rows: number): IslandSize {
  const shown = Math.min(Math.max(rows, 1), GLOBAL_VOICE_PICKER_ROWS);
  return { width: GLOBAL_VOICE_ISLAND.picker.width, height: PICKER_CHROME + shown * GLOBAL_VOICE_PICKER_ROW };
}

/** The bottom corner radius for a size: round like a pill when small, the island radius when open. */
export function islandRadius(size: IslandSize): number {
  return Math.min(GLOBAL_VOICE_ISLAND_RADIUS, size.height / 2);
}

/**
 * Keyframes that morph the island from one size to the next, like the Dynamic Island: width, height
 * and corner radius follow one spring. The island is small, so animating its size is cheap. Reduced
 * motion fades, with no change of size.
 */
export function islandMorphKeyframes(
  from: IslandSize,
  to: IslandSize,
  reducedMotion: boolean,
  floating = false,
): Keyframe[] {
  const end = {
    width: `${to.width}px`,
    height: `${to.height}px`,
    borderRadius: radiusValue(islandRadius(to), floating),
  };
  if (reducedMotion || to.width <= 0 || to.height <= 0) {
    return [
      { ...end, opacity: 0 },
      { ...end, opacity: 1 },
    ];
  }
  const fromRadius = islandRadius(from);
  const toRadius = islandRadius(to);
  return islandSpringKeyframes((progress) => ({
    opacity: Math.min(1, 0.4 + progress * 2),
    width: `${Math.max(0, from.width + (to.width - from.width) * progress)}px`,
    height: `${Math.max(0, from.height + (to.height - from.height) * progress)}px`,
    borderRadius: radiusValue(Math.max(0, fromRadius + (toRadius - fromRadius) * progress), floating),
  }));
}

/** The top corners stay square, flush with the screen edge like the notch. */
/** Under a notch the top corners stay square to merge with it; a floating pill rounds all four. */
function radiusValue(radius: number, floating = false): string {
  const value = `${radius.toFixed(2)}px`;
  return floating ? value : `0 0 ${value} ${value}`;
}

/** `rtl` when the text is mostly Arabic, so a name stays right to left in an English island. */
export function globalVoiceTextDirection(value: string): "rtl" | "ltr" {
  const arabic = value.match(/\p{Script=Arabic}/gu)?.length ?? 0;
  const latin = value.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return arabic > latin ? "rtl" : "ltr";
}

/**
 * Samples the spring over the whole morph, overshoot included. The shared helper stops at the
 * response time and stretches the curve to reach 1 there, which cut the spring short.
 */
function islandSpringKeyframes(frame: (progress: number) => Keyframe, sampleCount = 45): Keyframe[] {
  const seconds = GLOBAL_VOICE_ISLAND_MORPH_MS / 1000;
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const offset = index / sampleCount;
    const progress = index === sampleCount ? 1 : springProgress(offset * seconds, GLOBAL_VOICE_ISLAND_SPRING);
    return { ...frame(progress), offset };
  });
}
