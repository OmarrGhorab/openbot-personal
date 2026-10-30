import {
  RAVEN_AUTOPILOT_MERGE_METHODS,
  RAVEN_AUTOPILOT_PRESET_IDS,
  RAVEN_AUTOPILOT_ROUND_CAP,
  RAVEN_AUTOPILOT_TICKET_TYPES,
  RAVEN_AUTOPILOT_TICKETS_AT_ONCE,
  type RavenAutopilotDecision,
  type RavenAutopilotMergeMethod,
  type RavenAutopilotPickUpAssignee,
  type RavenAutopilotPresetId,
  type RavenAutopilotSettings,
  type RavenAutopilotTicketType,
  type RavenTeamJob,
  ravenAutopilotPreset,
} from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Badge,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@openbot/ui";
import { ArrowRight, Check, GitMerge, Minus, Plus, Sparkles } from "@openbot/ui/icons";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { isTerminalJob } from "./RavenTeamJobCard";
import { RavenTeamRoleIcon } from "./RavenTeamRoleIcon";
import type { RavenTeamModelChoice } from "./RavenTeamRolePicker";

export interface RavenAutopilotPanelProps {
  settings: RavenAutopilotSettings;
  jobs: RavenTeamJob[];
  models: RavenTeamModelChoice[];
  /** Saves the whole settings. The host shows the saved settings when the call ends. */
  onChange: (settings: RavenAutopilotSettings) => Promise<unknown>;
}

/** How many decisions the tab shows. */
const RECENT_DECISIONS = 3;

const TYPE_KEY = {
  feature: "agent.team.autopilot.type.feature",
  bug: "agent.team.autopilot.type.bug",
  chore: "agent.team.autopilot.type.chore",
} as const;

const METHOD_KEY = {
  squash: "agent.team.autopilot.merge.method.squash",
  merge: "agent.team.autopilot.merge.method.merge",
  rebase: "agent.team.autopilot.merge.method.rebase",
} as const;

const PICK_UP_KEY = {
  "raven-or-unassigned": "agent.team.autopilot.pickUp.ravenOrUnassigned",
  raven: "agent.team.autopilot.pickUp.raven",
} as const;

interface Option<Id extends string> {
  id: Id;
  label: string;
}

type OverrideChoice = RavenAutopilotPresetId | "auto";

/** The decisions saved on jobs, newest first. */
function recentDecisions(jobs: readonly RavenTeamJob[]): RavenAutopilotDecision[] {
  return jobs
    .flatMap((job) => (job.decision ? [job.decision] : []))
    .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))
    .slice(0, RECENT_DECISIONS);
}

/**
 * The Autopilot tab of the Raven team page: the master switch with live counts, "Raven picks the stack"
 * with its recent decisions, the optional overrides per ticket type, and the guardrails with the merge
 * settings. Every change saves the whole settings through `onChange`; the settings stay on this computer.
 */
export function RavenAutopilotPanel(props: RavenAutopilotPanelProps) {
  const { t, errorMessage } = useText();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const change = (edit: (draft: RavenAutopilotSettings) => void) => {
    const draft = structuredClone(props.settings);
    edit(draft);
    setBusy(true);
    setError(null);
    void props
      .onChange(draft)
      .catch((failure: unknown) => setError(errorMessage(failure, t("agent.team.autopilot.saveFailed"))))
      .finally(() => setBusy(false));
  };

  const running = () => props.jobs.filter((job) => job.state === "running" && !job.queued).length;
  const waiting = () => props.jobs.filter((job) => !isTerminalJob(job) && job.queued).length;
  const decisions = () => recentDecisions(props.jobs);
  const modelName = (model: string) => props.models.find((choice) => choice.id === model)?.name ?? model;

  const stackLabel = (stack: RavenAutopilotDecision["stack"], templateId: string | null, playbook: string | null) => {
    if (stack === "pstack")
      return playbook
        ? t("agent.team.autopilot.stack.label", { stack: t("agent.team.autopilot.stack.pstack"), variant: playbook })
        : t("agent.team.autopilot.stack.pstack");
    const variant =
      templateId === "raven-stack-team"
        ? t("agent.team.template.full")
        : templateId === "raven-stack-lite"
          ? t("agent.team.template.lite")
          : templateId;
    return variant
      ? t("agent.team.autopilot.stack.label", { stack: t("agent.team.autopilot.stack.ravenStack"), variant })
      : t("agent.team.autopilot.stack.ravenStack");
  };
  const presetLabel = (id: RavenAutopilotPresetId) => {
    const preset = ravenAutopilotPreset(id);
    return stackLabel(preset.stack, preset.templateId, preset.playbook);
  };

  const overrideOptions = (): Option<OverrideChoice>[] => [
    { id: "auto", label: t("agent.team.autopilot.overrides.auto") },
    ...RAVEN_AUTOPILOT_PRESET_IDS.map((id) => ({ id, label: presetLabel(id) })),
  ];
  const pickUpOptions = (): Option<RavenAutopilotPickUpAssignee>[] => [
    { id: "raven-or-unassigned", label: t(PICK_UP_KEY["raven-or-unassigned"]) },
    { id: "raven", label: t(PICK_UP_KEY.raven) },
  ];
  const methodOptions = (): Option<RavenAutopilotMergeMethod>[] =>
    RAVEN_AUTOPILOT_MERGE_METHODS.map((id) => ({ id, label: t(METHOD_KEY[id]) }));
  const noMergeType = () =>
    props.settings.reviewerMerge.enabled &&
    RAVEN_AUTOPILOT_TICKET_TYPES.every((type) => !props.settings.reviewerMerge.types[type]);
  const pickUpHint = () =>
    props.settings.pickUp.assignee === "raven"
      ? t("agent.team.autopilot.pickUp.hintRaven")
      : t("agent.team.autopilot.pickUp.hint");

  return (
    <div class="raven-autopilot">
      <div class="raven-autopilot-main">
        <Show when={error()}>
          {(message) => (
            <Alert tone="danger" role="alert">
              <AlertContent>
                <AlertDescription>{message()}</AlertDescription>
              </AlertContent>
            </Alert>
          )}
        </Show>

        <section class="raven-team-panel raven-autopilot-master" data-on={props.settings.enabled ? "" : undefined}>
          <Switch
            class="raven-autopilot-switch"
            checked={props.settings.enabled}
            disabled={busy()}
            aria-label={t("agent.team.autopilot.master.label")}
            onChange={(on: boolean) =>
              change((draft) => {
                draft.enabled = on;
              })
            }
          />
          <div class="raven-autopilot-master-text">
            <h3 class="raven-team-subtitle">
              {props.settings.enabled ? t("agent.team.autopilot.master.on") : t("agent.team.autopilot.master.off")}
            </h3>
            <p class="raven-team-hint">{t("agent.team.autopilot.master.hint")}</p>
          </div>
          <dl class="raven-autopilot-counts">
            <div class="raven-autopilot-count" data-kind="running">
              <dt>
                <span class="raven-team-dot" aria-hidden="true" />
                {t("agent.team.autopilot.count.running")}
              </dt>
              <dd>{running()}</dd>
            </div>
            <div class="raven-autopilot-count" data-kind="waiting">
              <dt>
                <span class="raven-team-dot" aria-hidden="true" />
                {t("agent.team.autopilot.count.waiting")}
              </dt>
              <dd>{waiting()}</dd>
            </div>
            <div class="raven-autopilot-count" data-kind="slots">
              <dt>
                <span class="raven-team-dot" aria-hidden="true" />
                {t("agent.team.autopilot.count.slots")}
              </dt>
              <dd>
                {t("agent.team.autopilot.count.slotsValue", {
                  used: Math.min(running(), props.settings.ticketsAtOnce),
                  total: props.settings.ticketsAtOnce,
                })}
              </dd>
            </div>
          </dl>
        </section>

        <section class="raven-team-panel" aria-labelledby="raven-autopilot-stack-title">
          <header class="raven-autopilot-row">
            <Sparkles class="raven-autopilot-accent-icon" aria-hidden="true" />
            <div class="raven-autopilot-row-text">
              <h3 id="raven-autopilot-stack-title" class="raven-autopilot-title">
                {t("agent.team.autopilot.autoStack.title")}
              </h3>
              <p class="raven-team-hint">
                {props.settings.autoStack
                  ? t("agent.team.autopilot.autoStack.hint")
                  : t("agent.team.autopilot.autoStack.offHint")}
              </p>
            </div>
            <Switch
              checked={props.settings.autoStack}
              disabled={busy()}
              aria-label={t("agent.team.autopilot.autoStack.title")}
              onChange={(on: boolean) =>
                change((draft) => {
                  draft.autoStack = on;
                })
              }
            />
          </header>
          <Show when={props.settings.autoStack}>
            <p class="raven-autopilot-note">
              <ArrowRight aria-hidden="true" />
              {t("agent.team.autopilot.autoStack.retry")}
            </p>
          </Show>
          <h4 class="raven-team-eyebrow">{t("agent.team.autopilot.decisions.title")}</h4>
          <Show
            when={decisions().length > 0}
            fallback={<p class="raven-team-hint raven-team-hint-small">{t("agent.team.autopilot.decisions.empty")}</p>}
          >
            <ul class="raven-autopilot-decisions">
              <For each={decisions()}>
                {(decision) => (
                  <li class="raven-autopilot-decision">
                    <div class="raven-autopilot-decision-head">
                      <TypeChip type={decision.ticketType} />
                      <span class="raven-autopilot-decision-title">{decision.ticketTitle}</span>
                      <ArrowRight class="raven-autopilot-decision-arrow" aria-hidden="true" />
                      <span class="raven-autopilot-stack-chip">
                        <Sparkles aria-hidden="true" />
                        {stackLabel(decision.stack, decision.templateId, decision.playbook)}
                      </span>
                      <Show when={decision.source === "override"}>
                        <Badge variant="outline">{t("agent.team.autopilot.decision.override")}</Badge>
                      </Show>
                    </div>
                    <ul class="raven-autopilot-decision-roles">
                      <For each={decision.roles}>
                        {(role) => (
                          <li class="raven-autopilot-model-chip" title={role.label}>
                            <RavenTeamRoleIcon roleId={role.roleId} />
                            {modelName(role.model)}
                          </li>
                        )}
                      </For>
                    </ul>
                    <p class="raven-team-hint raven-team-hint-small">{decision.reason}</p>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section class="raven-team-panel" aria-labelledby="raven-autopilot-overrides-title">
          <div>
            <h3 id="raven-autopilot-overrides-title" class="raven-autopilot-title">
              {t("agent.team.autopilot.overrides.title")}
            </h3>
            <p class="raven-team-hint">{t("agent.team.autopilot.overrides.hint")}</p>
          </div>
          <ul class="raven-autopilot-overrides">
            <For each={RAVEN_AUTOPILOT_TICKET_TYPES}>
              {(type) => {
                const current = (): OverrideChoice => props.settings.overrides[type]?.preset ?? "auto";
                return (
                  <li class="raven-autopilot-override">
                    <span class="raven-autopilot-override-type">
                      <span class="raven-autopilot-type-dot" data-type={type} aria-hidden="true" />
                      {t(TYPE_KEY[type])}
                    </span>
                    <Select<Option<OverrideChoice>>
                      class="raven-autopilot-override-choice"
                      options={overrideOptions()}
                      optionValue="id"
                      optionTextValue="label"
                      value={overrideOptions().find((option) => option.id === current()) ?? null}
                      disabled={busy()}
                      onChange={(option) => {
                        if (!option || option.id === current()) return;
                        const chosen = option.id;
                        change((draft) => {
                          draft.overrides[type] = chosen === "auto" ? null : { preset: chosen, models: {} };
                        });
                      }}
                      itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.label}</SelectItem>}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t("agent.team.autopilot.overrides.choice", { type: t(TYPE_KEY[type]) })}
                      >
                        <SelectValue<Option<OverrideChoice>>>
                          {(state) => (
                            <span
                              class="raven-autopilot-override-value"
                              data-auto={current() === "auto" ? "" : undefined}
                            >
                              <Show when={current() === "auto"}>
                                <Sparkles aria-hidden="true" />
                              </Show>
                              {state.selectedOption()?.label ?? t("agent.team.autopilot.overrides.auto")}
                            </span>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                    <span class="raven-autopilot-automerge">
                      <span aria-hidden="true">{t("agent.team.autopilot.overrides.autoMerge")}</span>
                      <Switch
                        checked={props.settings.reviewerMerge.types[type]}
                        disabled={busy()}
                        aria-label={t("agent.team.autopilot.overrides.autoMergeFor", { type: t(TYPE_KEY[type]) })}
                        onChange={(on: boolean) =>
                          change((draft) => {
                            draft.reviewerMerge.types[type] = on;
                          })
                        }
                      />
                    </span>
                  </li>
                );
              }}
            </For>
          </ul>
          <p class="raven-team-hint raven-team-hint-small">{t("agent.team.autopilot.overrides.newOnly")}</p>
        </section>
      </div>

      <aside class="raven-autopilot-guardrails" aria-labelledby="raven-autopilot-guardrails-title">
        <h3 id="raven-autopilot-guardrails-title" class="raven-team-eyebrow">
          {t("agent.team.autopilot.guardrails.title")}
        </h3>

        <Setting title={t("agent.team.autopilot.pickUp.title")} hint={pickUpHint()}>
          <Select<Option<RavenAutopilotPickUpAssignee>>
            class="raven-autopilot-wide"
            options={pickUpOptions()}
            optionValue="id"
            optionTextValue="label"
            value={pickUpOptions().find((option) => option.id === props.settings.pickUp.assignee) ?? null}
            disabled={busy()}
            onChange={(option) => {
              if (!option || option.id === props.settings.pickUp.assignee) return;
              const assignee = option.id;
              change((draft) => {
                draft.pickUp.assignee = assignee;
              });
            }}
            itemComponent={(item) => (
              <SelectItem item={item.item}>
                {t("agent.team.autopilot.pickUp.value", {
                  column: t("agent.team.autopilot.pickUp.backlog"),
                  assignee: item.item.rawValue.label,
                })}
              </SelectItem>
            )}
          >
            <SelectTrigger size="sm" aria-label={t("agent.team.autopilot.pickUp.title")}>
              <SelectValue<Option<RavenAutopilotPickUpAssignee>>>
                {(state) => (
                  <span>
                    <strong>{t("agent.team.autopilot.pickUp.backlog")}</strong>
                    <span class="raven-autopilot-muted"> · {state.selectedOption()?.label}</span>
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        </Setting>

        <Setting
          title={t("agent.team.autopilot.ticketsAtOnce.title")}
          hint={t("agent.team.autopilot.ticketsAtOnce.hint")}
          control={
            <Stepper
              label={t("agent.team.autopilot.ticketsAtOnce.title")}
              value={props.settings.ticketsAtOnce}
              min={RAVEN_AUTOPILOT_TICKETS_AT_ONCE.min}
              max={RAVEN_AUTOPILOT_TICKETS_AT_ONCE.max}
              disabled={busy()}
              onValue={(value) =>
                change((draft) => {
                  draft.ticketsAtOnce = value;
                })
              }
            />
          }
        />

        <Setting
          title={t("agent.team.autopilot.rounds.title")}
          hint={t("agent.team.autopilot.rounds.hint")}
          control={
            <Stepper
              label={t("agent.team.autopilot.rounds.title")}
              value={props.settings.roundCap}
              min={RAVEN_AUTOPILOT_ROUND_CAP.min}
              max={RAVEN_AUTOPILOT_ROUND_CAP.max}
              disabled={busy()}
              onValue={(value) =>
                change((draft) => {
                  draft.roundCap = value;
                })
              }
            />
          }
        />

        <Setting
          title={t("agent.team.autopilot.pause.title")}
          hint={t("agent.team.autopilot.pause.hint")}
          control={
            <Switch
              checked={props.settings.pauseOnUsageLimit}
              disabled={busy()}
              aria-label={t("agent.team.autopilot.pause.title")}
              onChange={(on: boolean) =>
                change((draft) => {
                  draft.pauseOnUsageLimit = on;
                })
              }
            />
          }
        />

        <hr class="raven-autopilot-divider" />

        <Setting
          icon={<GitMerge aria-hidden="true" />}
          title={t("agent.team.autopilot.merge.title")}
          hint={t("agent.team.autopilot.merge.hint")}
          control={
            <Switch
              checked={props.settings.reviewerMerge.enabled}
              disabled={busy()}
              aria-label={t("agent.team.autopilot.merge.title")}
              onChange={(on: boolean) =>
                change((draft) => {
                  draft.reviewerMerge.enabled = on;
                })
              }
            />
          }
        />
        <Show when={noMergeType()}>
          <p class="raven-team-role-skipnote">{t("agent.team.autopilot.merge.noType")}</p>
        </Show>
        <div class="raven-autopilot-rules">
          <h4 class="raven-team-eyebrow">{t("agent.team.autopilot.merge.when")}</h4>
          <ul>
            <li>
              <Check aria-hidden="true" />
              {t("agent.team.autopilot.merge.rule.pass")}
            </li>
            <li>
              <Check aria-hidden="true" />
              {t("agent.team.autopilot.merge.rule.quality")}
            </li>
            <li>
              <Check aria-hidden="true" />
              {t("agent.team.autopilot.merge.rule.ci")}
            </li>
            <li>
              <Check aria-hidden="true" />
              {t("agent.team.autopilot.merge.rule.fresh")}
            </li>
          </ul>
        </div>
        <Select<Option<RavenAutopilotMergeMethod>>
          class="raven-autopilot-wide"
          options={methodOptions()}
          optionValue="id"
          optionTextValue="label"
          value={methodOptions().find((option) => option.id === props.settings.reviewerMerge.method) ?? null}
          disabled={busy()}
          onChange={(option) => {
            if (!option || option.id === props.settings.reviewerMerge.method) return;
            const method = option.id;
            change((draft) => {
              draft.reviewerMerge.method = method;
            });
          }}
          itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.label}</SelectItem>}
        >
          <SelectTrigger size="sm" aria-label={t("agent.team.autopilot.merge.method")}>
            <SelectValue<Option<RavenAutopilotMergeMethod>>>
              {(state) => (
                <span>
                  <span class="raven-autopilot-muted">{t("agent.team.autopilot.merge.method")} </span>
                  {state.selectedOption()?.label}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent />
        </Select>
        <p class="raven-team-hint raven-team-hint-small">{t("agent.team.autopilot.merge.note")}</p>

        <Setting
          title={t("agent.team.autopilot.notify.title")}
          hint={t("agent.team.autopilot.notify.hint")}
          control={
            <Switch
              checked={props.settings.notifyOnMerge}
              disabled={busy()}
              aria-label={t("agent.team.autopilot.notify.title")}
              onChange={(on: boolean) =>
                change((draft) => {
                  draft.notifyOnMerge = on;
                })
              }
            />
          }
        />
      </aside>
    </div>
  );
}

/** The ticket type chip of a decision. A ticket with no type says so. */
function TypeChip(props: { type: RavenAutopilotTicketType | null }) {
  const { t } = useText();
  return (
    <span class="raven-autopilot-type-chip">
      <span class="raven-autopilot-type-dot" data-type={props.type ?? "none"} aria-hidden="true" />
      {props.type ? t(TYPE_KEY[props.type]) : t("agent.team.autopilot.type.none")}
    </span>
  );
}

/** One guardrail: a title, its control at the end of the line, and one line under it. */
function Setting(props: {
  title: string;
  hint: string;
  icon?: JSX.Element;
  control?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <div class="raven-autopilot-setting">
      <div class="raven-autopilot-setting-head">
        <span class="raven-autopilot-setting-title">
          {props.icon}
          {props.title}
        </span>
        {props.control}
      </div>
      <p class="raven-team-hint raven-team-hint-small">{props.hint}</p>
      {props.children}
    </div>
  );
}

/** A whole number with a minus and a plus button, held between `min` and `max`. */
function Stepper(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onValue: (value: number) => void;
}) {
  const { t } = useText();
  return (
    <span class="raven-autopilot-stepper">
      <IconButton
        size="icon-xs"
        variant="ghost"
        label={t("agent.team.autopilot.stepper.less", { setting: props.label })}
        disabled={props.disabled || props.value <= props.min}
        onClick={() => props.onValue(props.value - 1)}
      >
        <Minus />
      </IconButton>
      <output class="raven-autopilot-stepper-value" aria-live="polite">
        {props.value}
      </output>
      <IconButton
        size="icon-xs"
        variant="ghost"
        label={t("agent.team.autopilot.stepper.more", { setting: props.label })}
        disabled={props.disabled || props.value >= props.max}
        onClick={() => props.onValue(props.value + 1)}
      >
        <Plus />
      </IconButton>
    </span>
  );
}
