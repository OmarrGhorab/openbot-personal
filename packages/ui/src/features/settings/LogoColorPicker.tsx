import {
  APP_LOGO_COLOR_HEX,
  APP_LOGO_COLORS,
  APP_LOGO_SHAPES,
  APP_LOGO_TILE_HEX,
  APP_LOGO_TILES,
  type AppLogoColor,
  type AppLogoShape,
  type AppLogoTile,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { useText } from "../../text";

const COLOR_LABEL_KEYS = {
  lavender: "settings.logoColor.lavender",
  green: "settings.logoColor.green",
  gold: "settings.logoColor.gold",
  terracotta: "settings.logoColor.terracotta",
  blue: "settings.logoColor.blue",
  rose: "settings.logoColor.rose",
  pink: "settings.logoColor.pink",
  beige: "settings.logoColor.beige",
  gray: "settings.logoColor.gray",
  white: "settings.logoColor.white",
} as const satisfies Record<AppLogoColor, AppTextKey>;

const SHAPE_LABEL_KEYS = {
  blob: "settings.appIcon.shape.blob",
  star: "settings.appIcon.shape.star",
  penguin: "settings.appIcon.shape.penguin",
  cloud: "settings.appIcon.shape.cloud",
  cat: "settings.appIcon.shape.cat",
  octopus: "settings.appIcon.shape.octopus",
  whale: "settings.appIcon.shape.whale",
  chick: "settings.appIcon.shape.chick",
  mountain: "settings.appIcon.shape.mountain",
  moon: "settings.appIcon.shape.moon",
} as const satisfies Record<AppLogoShape, AppTextKey>;

const TILE_LABEL_KEYS = {
  dark: "settings.appIcon.tile.dark",
  light: "settings.appIcon.tile.light",
  tint: "settings.appIcon.tile.tint",
} as const satisfies Record<AppLogoTile, AppTextKey>;

export interface LogoColorPickerProps {
  value: AppLogoColor;
  onChange: (value: AppLogoColor) => void;
  /** The group name. Default: the logo color title. */
  label?: string | undefined;
  disabled?: boolean | undefined;
  class?: string | undefined;
}

/** One swatch for each logo color, in the same shape as the agent avatar color grid. */
export function LogoColorPicker(props: LogoColorPickerProps): JSX.Element {
  const { t } = useText();
  return (
    <fieldset
      class={["logo-color-grid", props.class]}
      aria-label={props.label ?? t("settings.logoColor.title")}
      disabled={props.disabled}
    >
      <For each={APP_LOGO_COLORS}>
        {(color) => (
          <Button
            variant="ghost"
            type="button"
            class={["logo-color-choice", { "logo-color-choice-selected": props.value === color }]}
            aria-label={t(COLOR_LABEL_KEYS[color])}
            aria-pressed={props.value === color ? "true" : "false"}
            data-cuelume-tap="select"
            onClick={() => props.onChange(color)}
          >
            <span class="logo-color-swatch" style={{ background: APP_LOGO_COLOR_HEX[color] }} />
          </Button>
        )}
      </For>
    </fieldset>
  );
}

export interface LogoShapePickerProps {
  /** The chosen mascot. Null when none is chosen, as for an agent with a shape avatar. */
  value: AppLogoShape | null;
  /** The picture of each mascot. The app passes the pictures in the current logo color. */
  imageUrl: (shape: AppLogoShape) => string;
  onChange: (value: AppLogoShape) => void;
  /** The group name. Default: the App icon mascot title. */
  label?: string | undefined;
  disabled?: boolean | undefined;
  class?: string | undefined;
}

/** One picture for each mascot that the app icon can show. */
export function LogoShapePicker(props: LogoShapePickerProps): JSX.Element {
  const { t } = useText();
  return (
    <fieldset
      class={["logo-shape-grid", props.class]}
      aria-label={props.label ?? t("settings.appIcon.shape.title")}
      disabled={props.disabled}
    >
      <For each={APP_LOGO_SHAPES}>
        {(shape) => (
          <Button
            variant="ghost"
            type="button"
            class={["logo-shape-choice", { "logo-color-choice-selected": props.value === shape }]}
            aria-label={t(SHAPE_LABEL_KEYS[shape])}
            aria-pressed={props.value === shape ? "true" : "false"}
            data-cuelume-tap="select"
            onClick={() => props.onChange(shape)}
          >
            <img class="logo-shape-image" src={props.imageUrl(shape)} alt="" draggable={false} />
          </Button>
        )}
      </For>
    </fieldset>
  );
}

export interface LogoTilePickerProps {
  value: AppLogoTile;
  /** The logo color, which the `tint` tile is a light shade of. */
  color: AppLogoColor;
  onChange: (value: AppLogoTile) => void;
}

/** One swatch for each tile behind the mascot on the app icon. */
export function LogoTilePicker(props: LogoTilePickerProps): JSX.Element {
  const { t } = useText();
  const swatch = (tile: AppLogoTile) =>
    tile === "tint" ? `color-mix(in srgb, ${APP_LOGO_COLOR_HEX[props.color]} 40%, white)` : APP_LOGO_TILE_HEX[tile];
  return (
    <fieldset class="logo-color-grid logo-tile-grid" aria-label={t("settings.appIcon.tile.title")}>
      <For each={APP_LOGO_TILES}>
        {(tile) => (
          <Button
            variant="ghost"
            type="button"
            class={["logo-color-choice", { "logo-color-choice-selected": props.value === tile }]}
            aria-label={t(TILE_LABEL_KEYS[tile])}
            aria-pressed={props.value === tile ? "true" : "false"}
            data-cuelume-tap="select"
            onClick={() => props.onChange(tile)}
          >
            <span class="logo-tile-swatch" style={{ background: swatch(tile) }} />
          </Button>
        )}
      </For>
    </fieldset>
  );
}
