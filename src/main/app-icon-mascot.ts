import {
  APP_LOGO_COLOR_HEX,
  APP_LOGO_TILE_HEX,
  type AppLogoColorPreference,
  type AppLogoTile,
} from "@openbot/contracts/ipc";
import { type NativeImage, nativeImage } from "electron";

/** The icon is drawn at the largest size the Dock shows. */
const ICON_SIZE = 512;

/**
 * macOS draws no tile of its own, so the icon keeps Apple's grid: a rounded square of 824 of 1024
 * points with transparent space around it. Other systems take a full-size tile.
 */
const TILE_LAYOUT = {
  darwin: { inset: 50, radius: 92, mascot: 330 },
  other: { inset: 0, radius: 92, mascot: 400 },
} as const;

/** A 1 × 1 red PNG. Its bitmap tells whether this platform orders pixels as RGBA or BGRA. */
const RED_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function tileRgb(tile: AppLogoTile, color: AppLogoColorPreference["color"]): Rgb {
  if (tile !== "tint") return hexToRgb(APP_LOGO_TILE_HEX[tile]);
  // A light shade of the logo color, so the mascot stands out on it.
  const [r, g, b] = hexToRgb(APP_LOGO_COLOR_HEX[color]);
  return [Math.round(r * 0.4 + 255 * 0.6), Math.round(g * 0.4 + 255 * 0.6), Math.round(b * 0.4 + 255 * 0.6)];
}

/** Coverage of one pixel by a rounded square, with one pixel of anti-aliasing at the edge. */
function roundedSquareCoverage(x: number, y: number, inset: number, radius: number): number {
  const half = (ICON_SIZE - inset * 2) / 2;
  const center = ICON_SIZE / 2;
  const qx = Math.abs(x + 0.5 - center) - (half - radius);
  const qy = Math.abs(y + 0.5 - center) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  return Math.min(Math.max(0.5 - outside, 0), 1);
}

/**
 * Draws the chosen mascot on its tile. The result is a premultiplied bitmap in the platform pixel
 * order, which is what `nativeImage.createFromBitmap` takes. Returns an empty image when the mascot
 * file cannot be read, so the caller keeps the current icon.
 */
export function composeMascotIcon(options: {
  preference: AppLogoColorPreference;
  mascotPath: string;
  platform: NodeJS.Platform;
}): NativeImage {
  const layout = options.platform === "darwin" ? TILE_LAYOUT.darwin : TILE_LAYOUT.other;
  const source = nativeImage.createFromPath(options.mascotPath);
  if (source.isEmpty()) return source;
  const mascot = source.resize({ width: layout.mascot, height: layout.mascot, quality: "best" }).toBitmap();
  const bgra = nativeImage.createFromDataURL(RED_PIXEL_PNG).toBitmap()[2] === 255;
  const [r, g, b] = tileRgb(options.preference.tile, options.preference.color);
  const tile: Rgb = bgra ? [b, g, r] : [r, g, b];

  const pixels = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4);
  const offset = Math.round((ICON_SIZE - layout.mascot) / 2);
  for (let y = 0; y < ICON_SIZE; y++) {
    // A slight light-to-dark gradient from top to bottom gives the tile some depth.
    const shade = 1.04 - (0.08 * y) / ICON_SIZE;
    for (let x = 0; x < ICON_SIZE; x++) {
      const at = (y * ICON_SIZE + x) * 4;
      const coverage = roundedSquareCoverage(x, y, layout.inset, layout.radius);
      let c0 = Math.min(tile[0] * shade, 255) * coverage;
      let c1 = Math.min(tile[1] * shade, 255) * coverage;
      let c2 = Math.min(tile[2] * shade, 255) * coverage;
      let alpha = 255 * coverage;
      const mx = x - offset;
      const my = y - offset;
      if (mx >= 0 && my >= 0 && mx < layout.mascot && my < layout.mascot) {
        const from = (my * layout.mascot + mx) * 4;
        const keep = 1 - (mascot[from + 3] ?? 0) / 255;
        c0 = (mascot[from] ?? 0) + c0 * keep;
        c1 = (mascot[from + 1] ?? 0) + c1 * keep;
        c2 = (mascot[from + 2] ?? 0) + c2 * keep;
        alpha = (mascot[from + 3] ?? 0) + alpha * keep;
      }
      pixels[at] = Math.round(c0);
      pixels[at + 1] = Math.round(c1);
      pixels[at + 2] = Math.round(c2);
      pixels[at + 3] = Math.round(alpha);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: ICON_SIZE, height: ICON_SIZE });
}
