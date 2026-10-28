import type { AgentReasoningEffort } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, Show } from "solid-js";

/** A model a connected provider lists. The page shows the name and keeps the id. */
export interface RavenTeamModelChoice {
  id: string;
  name: string;
  /** The provider that lists the model, as the model list names it. */
  provider: string;
  /** The provider's display name, as the provider picker shows it. */
  providerName: string;
  /** The efforts the model supports. Empty when the model has no effort levels. */
  efforts: AgentReasoningEffort[];
  /** The model's own effort. Null when it has no effort levels. */
  defaultEffort: AgentReasoningEffort | null;
}

/** The effort names of the provider picker. */
export const RAVEN_TEAM_EFFORT_LABEL = {
  low: "provider.effort.low",
  medium: "provider.effort.medium",
  high: "provider.effort.high",
  xhigh: "provider.effort.xhigh",
  max: "provider.effort.max",
} as const satisfies Record<AgentReasoningEffort, AppTextKey>;

interface PickerOption {
  id: string;
  label: string;
}

export interface RavenTeamRolePickerProps {
  /** The role's name, for the accessible names of the fields. */
  role: string;
  models: RavenTeamModelChoice[];
  /** The role's model id. A model that no provider lists shows as its id. */
  model: string;
  /** The role's effort. Absent: the picker has no effort field, as on a running job. */
  effort?: AgentReasoningEffort | null | undefined;
  disabled?: boolean | undefined;
  onModel: (model: string) => void;
  onEffort?: ((effort: AgentReasoningEffort) => void) | undefined;
}

/**
 * The model of one team role in three steps: the provider, then the models of that provider, then the
 * effort. A model with no effort levels shows a disabled effort field. These are the app `Select`,
 * with the provider names and effort names of the provider picker: a role has no wall of model chips.
 */
export function RavenTeamRolePicker(props: RavenTeamRolePickerProps) {
  const { t } = useText();
  const current = createMemo(() => props.models.find((model) => model.id === props.model) ?? null);
  const providers = createMemo<PickerOption[]>(() => {
    const seen = new Map<string, string>();
    for (const model of props.models) if (!seen.has(model.provider)) seen.set(model.provider, model.providerName);
    return [...seen].map(([id, label]) => ({ id, label }));
  });
  const provider = () => providers().find((option) => option.id === current()?.provider) ?? null;
  const providerModels = createMemo<PickerOption[]>(() => {
    const chosen = current()?.provider;
    const list = props.models
      .filter((model) => model.provider === chosen)
      .map((model) => ({ id: model.id, label: model.name }));
    // A model that no connected provider lists stays visible by its id, so the user sees what to change.
    return current() === null && props.model ? [{ id: props.model, label: props.model }, ...list] : list;
  });
  const model = () => providerModels().find((option) => option.id === props.model) ?? null;
  const efforts = createMemo<PickerOption[]>(() =>
    (current()?.efforts ?? []).map((effort) => ({ id: effort, label: t(RAVEN_TEAM_EFFORT_LABEL[effort]) })),
  );
  const effort = () => efforts().find((option) => option.id === props.effort) ?? null;
  const fieldLabel = (field: string) => t("agent.team.roleField", { field, role: props.role });

  /** A new provider takes its first model. The page checks the plan again with it. */
  const pickProvider = (option: PickerOption | null) => {
    if (!option || option.id === current()?.provider) return;
    const first = props.models.find((candidate) => candidate.provider === option.id);
    if (first) props.onModel(first.id);
  };
  const pickModel = (option: PickerOption | null) => {
    if (option && option.id !== props.model) props.onModel(option.id);
  };
  const pickEffort = (option: PickerOption | null) => {
    const chosen = current()?.efforts.find((candidate) => candidate === option?.id);
    if (chosen && chosen !== props.effort) props.onEffort?.(chosen);
  };

  return (
    <div class="raven-team-picker" data-effort={props.effort === undefined ? "hidden" : "shown"}>
      <Select<PickerOption>
        class="raven-team-picker-field"
        options={providers()}
        optionValue="id"
        optionTextValue="label"
        value={provider()}
        disabled={props.disabled ?? false}
        onChange={pickProvider}
        itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.label}</SelectItem>}
      >
        <SelectTrigger size="sm" aria-label={fieldLabel(t("agent.team.provider"))}>
          <SelectValue<PickerOption>>
            {(state) => state.selectedOption()?.label ?? t("agent.team.provider")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
      <Select<PickerOption>
        class="raven-team-picker-field"
        options={providerModels()}
        optionValue="id"
        optionTextValue="label"
        value={model()}
        disabled={(props.disabled ?? false) || providerModels().length === 0}
        onChange={pickModel}
        itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.label}</SelectItem>}
      >
        <SelectTrigger size="sm" aria-label={fieldLabel(t("agent.team.model"))}>
          <SelectValue<PickerOption>>{(state) => state.selectedOption()?.label ?? t("agent.team.model")}</SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
      <Show when={props.effort !== undefined}>
        <Select<PickerOption>
          class="raven-team-picker-field"
          options={efforts()}
          optionValue="id"
          optionTextValue="label"
          value={effort()}
          disabled={(props.disabled ?? false) || efforts().length === 0}
          onChange={pickEffort}
          itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.label}</SelectItem>}
        >
          <SelectTrigger size="sm" aria-label={fieldLabel(t("provider.picker.effort"))}>
            <SelectValue<PickerOption>>
              {(state) =>
                state.selectedOption()?.label ??
                (efforts().length ? t("provider.picker.effort") : t("agent.team.noEffort"))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent />
        </Select>
      </Show>
    </div>
  );
}
