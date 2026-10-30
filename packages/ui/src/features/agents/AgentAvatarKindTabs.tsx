import {
  type AppLogoColor,
  type AppLogoShape,
  agentMascotSeed,
  DEFAULT_APP_LOGO_COLOR,
  parseAgentMascotSeed,
} from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createSignal, untrack } from "solid-js";
import { mascotImageUrl } from "../../mascot-avatar";
import { SlidingTabs } from "../../sliding-tabs";
import { useText } from "../../text";
import { LogoColorPicker, LogoShapePicker } from "../settings/LogoColorPicker";

type AvatarKind = "shapes" | "mascots";

export interface AgentAvatarKindTabsProps {
  /** The agent's avatar seed. A `mascot:<shape>:<color>` seed opens the Mascots tab. */
  seed: string;
  /** The shape choices of the surface: its face grid, and its color row when it has one. */
  shapes: JSX.Element;
  /** Saves a mascot avatar. The value is the seed to save as `avatarSeed`. */
  onMascot: (seed: string) => void;
  disabled?: boolean | undefined;
  class?: string | undefined;
}

/**
 * The avatar picker of an agent: Shapes, the generated colored shapes with two eyes, and Mascots, the
 * App icon mascots (`build/mascots`) in each logo color. A mascot is saved in the same `avatarSeed`
 * as a shape, so the choice keeps working after a restart and a provider switch.
 */
export function AgentAvatarKindTabs(props: AgentAvatarKindTabsProps): JSX.Element {
  const { t } = useText();
  const current = () => parseAgentMascotSeed(props.seed);
  const [kind, setKind] = createSignal<AvatarKind>(untrack(() => (current() ? "mascots" : "shapes")));
  const [color, setColor] = createSignal<AppLogoColor>(untrack(() => current()?.color ?? DEFAULT_APP_LOGO_COLOR));
  const shownColor = () => current()?.color ?? color();

  const pickColor = (next: AppLogoColor) => {
    setColor(next);
    const mascot = current();
    if (mascot && mascot.color !== next) props.onMascot(agentMascotSeed({ shape: mascot.shape, color: next }));
  };
  const pickShape = (shape: AppLogoShape) => props.onMascot(agentMascotSeed({ shape, color: shownColor() }));

  return (
    <SlidingTabs.Root
      class={`agent-avatar-kind ${props.class ?? ""}`}
      value={kind()}
      onChange={(value) => {
        if (value === "shapes" || value === "mascots") setKind(value);
      }}
    >
      <SlidingTabs.List class="agent-avatar-kind-tabs" aria-label={t("agent.avatar.kind")}>
        <SlidingTabs.Trigger value="shapes" disabled={props.disabled}>
          {t("agent.avatar.shapes")}
        </SlidingTabs.Trigger>
        <SlidingTabs.Trigger value="mascots" disabled={props.disabled}>
          {t("agent.avatar.mascots")}
        </SlidingTabs.Trigger>
      </SlidingTabs.List>
      <SlidingTabs.ContentSlot class="agent-avatar-kind-slot">
        <SlidingTabs.Content value="shapes" class="agent-avatar-kind-panel">
          {props.shapes}
        </SlidingTabs.Content>
        <SlidingTabs.Content value="mascots" class="agent-avatar-kind-panel agent-avatar-kind-mascots">
          <p class="agent-avatar-kind-hint">{t("agent.avatar.mascotsHint")}</p>
          <LogoShapePicker
            class="agent-avatar-mascot-grid"
            label={t("agent.avatar.mascots")}
            value={current()?.shape ?? null}
            imageUrl={(shape) => mascotImageUrl(shape, shownColor())}
            disabled={props.disabled}
            onChange={pickShape}
          />
          <LogoColorPicker
            class="agent-avatar-mascot-colors"
            label={t("agent.avatar.mascotColor")}
            value={shownColor()}
            disabled={props.disabled}
            onChange={pickColor}
          />
        </SlidingTabs.Content>
      </SlidingTabs.ContentSlot>
    </SlidingTabs.Root>
  );
}
