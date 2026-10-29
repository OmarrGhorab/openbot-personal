import { join } from "node:path";
import type { AppLogoColor, AppLogoShape, AppVariant } from "@openbot/contracts/ipc";

const APP_VARIANTS = ["production", "dev", "preview"] as const satisfies readonly AppVariant[];

export function readAppVariant(value: string | undefined, isPackaged: boolean): AppVariant {
  if (isAppVariant(value)) return value;
  return isPackaged ? "production" : "dev";
}

function appIconFileName(variant: AppVariant, platform: NodeJS.Platform): string {
  return platform === "darwin" ? `icon-${variant}-macos-safe-area.png` : `icon-${variant}.png`;
}

export function resolveAppIconPath(options: {
  variant: AppVariant;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  resourcesPath: string;
  sourceRoot: string;
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, "icons", appIconFileName(options.variant, options.platform))
    : join(options.sourceRoot, "build", appIconFileName(options.variant, options.platform));
}

/** The mascot picture for a shape and color. `build/mascots/` holds one transparent PNG for each pair. */
export function resolveMascotPath(options: {
  shape: AppLogoShape;
  color: AppLogoColor;
  isPackaged: boolean;
  resourcesPath: string;
  sourceRoot: string;
}): string {
  const fileName = `${options.shape}-${options.color}.png`;
  return options.isPackaged
    ? join(options.resourcesPath, "icons", "mascots", fileName)
    : join(options.sourceRoot, "build", "mascots", fileName);
}

function isAppVariant(value: string | undefined): value is AppVariant {
  return APP_VARIANTS.some((variant) => variant === value);
}
