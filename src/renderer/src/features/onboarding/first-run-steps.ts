import type { DesktopPlatform } from "@openbot/contracts/ipc";

export type FirstRunStep = "choose" | "plan" | "computer";
/** How the user starts. `null` is the screen before they choose, and it shows the same steps as free. */
export type FirstRunPath = "free" | "plan" | null;

/**
 * The first-run steps after account sign-in. The plan step is only on the plan path.
 * Only macOS adds the Computer Use step. Other systems stop after the choice, or after the plan.
 */
export function firstRunSteps(path: FirstRunPath, platform: DesktopPlatform): FirstRunStep[] {
  const permissions: FirstRunStep[] = platform === "darwin" ? ["computer"] : [];
  return path === "plan" ? ["choose", "plan", ...permissions] : ["choose", ...permissions];
}
