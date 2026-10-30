import { integerInRange, isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "./runtime-values";

/**
 * Raven Autopilot: the settings of the Autopilot tab on the Raven team page, and the decision that
 * Autopilot saves on a team job.
 *
 * The settings stay on this computer, in one version 1 preference file that main owns
 * (`src/main/raven-autopilot-settings.ts`). Every field has a default, so a missing file, an old file
 * or a missing field reads as the defaults: the user turns `enabled` on and nothing else.
 *
 * Readers:
 * - The Autopilot engine (#196) reads `enabled`, `autoStack`, `overrides`, `pickUp`, `ticketsAtOnce`,
 *   `roundCap` and `pauseOnUsageLimit`. It reads an override only when it makes a new decision, and it
 *   saves the decision on the job (`RavenTeamJob.decision`). A running job keeps its decision.
 * - The Reviewer merge (#198) calls `ravenAutopilotMayMerge(settings, type)` each time before it merges,
 *   so a switch that goes off stops the next merge at once.
 * - The merge notification (#199) reads `notifyOnMerge`.
 */

/**
 * The ticket types that Autopilot knows. The strings are the same as the board ticket `type` of #187
 * (`feature` | `bug` | `chore`; `null` there means "not set yet").
 */
export const RAVEN_AUTOPILOT_TICKET_TYPES = ["feature", "bug", "chore"] as const;
export type RavenAutopilotTicketType = (typeof RAVEN_AUTOPILOT_TICKET_TYPES)[number];

/** The stacks that Autopilot can pick. */
export const RAVEN_AUTOPILOT_STACKS = ["raven-stack", "pstack"] as const;
export type RavenAutopilotStack = (typeof RAVEN_AUTOPILOT_STACKS)[number];

/** The fixed choices that an override can set for a ticket type. They are code, not user data. */
export const RAVEN_AUTOPILOT_PRESET_IDS = ["raven-stack-full", "raven-stack-lite", "pstack-tdd"] as const;
export type RavenAutopilotPresetId = (typeof RAVEN_AUTOPILOT_PRESET_IDS)[number];

export interface RavenAutopilotPreset {
  id: RavenAutopilotPresetId;
  stack: RavenAutopilotStack;
  /** The Raven team template the job starts with. Null for a stack that has no Raven team template. */
  templateId: string | null;
  /** The playbook of the stack, such as `tdd`. Null when the stack runs without one. */
  playbook: string | null;
}

// The template ids are `RAVEN_STACK_TEAM_TEMPLATE_ID` and `RAVEN_STACK_LITE_TEMPLATE_ID` of
// `ipc-raven-team.ts`, written out: that module imports this one for the job decision.
export const RAVEN_AUTOPILOT_PRESETS: readonly RavenAutopilotPreset[] = [
  { id: "raven-stack-full", stack: "raven-stack", templateId: "raven-stack-team", playbook: null },
  { id: "raven-stack-lite", stack: "raven-stack", templateId: "raven-stack-lite", playbook: null },
  { id: "pstack-tdd", stack: "pstack", templateId: null, playbook: "tdd" },
];

/**
 * The skill folder of a pstack playbook. The marketplace pack `pstack` installs each pstack skill as
 * `pstack-<name>`, so the `tdd` playbook is the skill `pstack-tdd`, called as `$pstack-tdd`.
 */
export function ravenPstackSkill(playbook: string): string {
  return `pstack-${playbook}`;
}

/** The playbooks that a preset can name. Autopilot checks that each one is installed before it uses it. */
export function ravenAutopilotPlaybooks(): string[] {
  return [...new Set(RAVEN_AUTOPILOT_PRESETS.flatMap((preset) => (preset.playbook ? [preset.playbook] : [])))];
}

export function ravenAutopilotPreset(id: RavenAutopilotPresetId): RavenAutopilotPreset {
  const preset = RAVEN_AUTOPILOT_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`Unknown Autopilot preset ${id}.`);
  return preset;
}

/**
 * A fixed choice for one ticket type. `null` in `RavenAutopilotSettings.overrides` is "Auto": Raven picks.
 * `models` maps a role id to a model id; a role that is not in it gets the model that Raven picks.
 */
export interface RavenAutopilotOverride {
  preset: RavenAutopilotPresetId;
  models: Record<string, string>;
}

/** Which board tickets Autopilot picks up. Only Backlog is offered now. */
export const RAVEN_AUTOPILOT_PICK_UP_COLUMNS = ["backlog"] as const;
export type RavenAutopilotPickUpColumn = (typeof RAVEN_AUTOPILOT_PICK_UP_COLUMNS)[number];
/** `raven-or-unassigned`: assigned to Raven, or to no one. `raven`: assigned to Raven only. */
export const RAVEN_AUTOPILOT_PICK_UP_ASSIGNEES = ["raven-or-unassigned", "raven"] as const;
export type RavenAutopilotPickUpAssignee = (typeof RAVEN_AUTOPILOT_PICK_UP_ASSIGNEES)[number];

export interface RavenAutopilotPickUp {
  column: RavenAutopilotPickUpColumn;
  assignee: RavenAutopilotPickUpAssignee;
}

export const RAVEN_AUTOPILOT_MERGE_METHODS = ["squash", "merge", "rebase"] as const;
export type RavenAutopilotMergeMethod = (typeof RAVEN_AUTOPILOT_MERGE_METHODS)[number];

export interface RavenAutopilotReviewerMerge {
  /** The explicit setting that lets the Reviewer write to the remote repository. Off by default. */
  enabled: boolean;
  /** The per-type switch. The Reviewer merges a ticket only when `enabled` and its type are on. */
  types: Record<RavenAutopilotTicketType, boolean>;
  method: RavenAutopilotMergeMethod;
}

export const RAVEN_AUTOPILOT_TICKETS_AT_ONCE = { min: 1, max: 8, default: 2 } as const;
export const RAVEN_AUTOPILOT_ROUND_CAP = { min: 1, max: 10, default: 3 } as const;

export interface RavenAutopilotSettings {
  /** The master switch. Off by default: Autopilot picks up no ticket. */
  enabled: boolean;
  /** Raven picks the stack, the team and the models for each ticket. On by default. */
  autoStack: boolean;
  /** A fixed choice per ticket type, or null for "Auto". It applies to new decisions only. */
  overrides: Record<RavenAutopilotTicketType, RavenAutopilotOverride | null>;
  pickUp: RavenAutopilotPickUp;
  /** How many tickets run at once. Default 2: a third ticket waits. */
  ticketsAtOnce: number;
  /** FAIL rounds before a job stops as not done. Default 3. */
  roundCap: number;
  /** Pause when a provider reports a usage limit; resume when it allows again. On by default. */
  pauseOnUsageLimit: boolean;
  reviewerMerge: RavenAutopilotReviewerMerge;
  /** Tell the user when a ticket merges (island, system notification, toast). On by default. */
  notifyOnMerge: boolean;
}

export const RAVEN_AUTOPILOT_DEFAULT_SETTINGS: RavenAutopilotSettings = {
  enabled: false,
  autoStack: true,
  overrides: { feature: null, bug: null, chore: null },
  pickUp: { column: "backlog", assignee: "raven-or-unassigned" },
  ticketsAtOnce: RAVEN_AUTOPILOT_TICKETS_AT_ONCE.default,
  roundCap: RAVEN_AUTOPILOT_ROUND_CAP.default,
  pauseOnUsageLimit: true,
  reviewerMerge: { enabled: false, types: { feature: false, bug: false, chore: false }, method: "squash" },
  notifyOnMerge: true,
};

/** A fresh copy of the defaults, so a caller can change it. */
export function defaultRavenAutopilotSettings(): RavenAutopilotSettings {
  return normalizeRavenAutopilotSettings(null);
}

/**
 * True when the Reviewer may merge a ticket of this type. A ticket with no type never merges. Call it
 * just before each merge: the settings can change while a job runs.
 */
export function ravenAutopilotMayMerge(
  settings: RavenAutopilotSettings,
  type: RavenAutopilotTicketType | null,
): boolean {
  return type !== null && settings.reviewerMerge.enabled && settings.reviewerMerge.types[type];
}

/** The override for a ticket type, or null for "Auto" and for a ticket with no type. */
export function ravenAutopilotOverride(
  settings: RavenAutopilotSettings,
  type: RavenAutopilotTicketType | null,
): RavenAutopilotOverride | null {
  return type === null ? null : settings.overrides[type];
}

const MODEL_ID_LIMIT = 160;
const OVERRIDE_MODEL_LIMIT = 12;

function isOverride(value: unknown): value is RavenAutopilotOverride {
  return (
    isDynamicRecord(value) &&
    isOneOf(RAVEN_AUTOPILOT_PRESET_IDS, value.preset) &&
    isDynamicRecord(value.models) &&
    Object.keys(value.models).length <= OVERRIDE_MODEL_LIMIT &&
    Object.entries(value.models).every(
      ([roleId, model]) => isIdentifier(roleId) && isBoundedString(model, MODEL_ID_LIMIT) && model !== "",
    )
  );
}

function integerOr(value: unknown, range: { min: number; max: number; default: number }): number {
  return integerInRange(value, range.min, range.max) ? value : range.default;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function record(value: unknown): DynamicRecord {
  return isDynamicRecord(value) ? value : {};
}

/**
 * Reads stored or sent settings field by field. A field that is missing or not valid takes its
 * default, so a file from an older build, or one that the user edited by hand, still reads.
 */
export function normalizeRavenAutopilotSettings(value: unknown): RavenAutopilotSettings {
  const source = record(value);
  const defaults = RAVEN_AUTOPILOT_DEFAULT_SETTINGS;
  const overrides = record(source.overrides);
  const pickUp = record(source.pickUp);
  const merge = record(source.reviewerMerge);
  const mergeTypes = record(merge.types);
  const override = (type: RavenAutopilotTicketType): RavenAutopilotOverride | null => {
    const stored = overrides[type];
    return isOverride(stored) ? { preset: stored.preset, models: { ...stored.models } } : null;
  };
  const mergeType = (type: RavenAutopilotTicketType) => booleanOr(mergeTypes[type], defaults.reviewerMerge.types[type]);
  return {
    enabled: booleanOr(source.enabled, defaults.enabled),
    autoStack: booleanOr(source.autoStack, defaults.autoStack),
    overrides: { feature: override("feature"), bug: override("bug"), chore: override("chore") },
    pickUp: {
      column: isOneOf(RAVEN_AUTOPILOT_PICK_UP_COLUMNS, pickUp.column) ? pickUp.column : defaults.pickUp.column,
      assignee: isOneOf(RAVEN_AUTOPILOT_PICK_UP_ASSIGNEES, pickUp.assignee)
        ? pickUp.assignee
        : defaults.pickUp.assignee,
    },
    ticketsAtOnce: integerOr(source.ticketsAtOnce, RAVEN_AUTOPILOT_TICKETS_AT_ONCE),
    roundCap: integerOr(source.roundCap, RAVEN_AUTOPILOT_ROUND_CAP),
    pauseOnUsageLimit: booleanOr(source.pauseOnUsageLimit, defaults.pauseOnUsageLimit),
    reviewerMerge: {
      enabled: booleanOr(merge.enabled, defaults.reviewerMerge.enabled),
      types: { feature: mergeType("feature"), bug: mergeType("bug"), chore: mergeType("chore") },
      method: isOneOf(RAVEN_AUTOPILOT_MERGE_METHODS, merge.method) ? merge.method : defaults.reviewerMerge.method,
    },
    notifyOnMerge: booleanOr(source.notifyOnMerge, defaults.notifyOnMerge),
  };
}

/** The strict check of settings that cross IPC. Use `normalizeRavenAutopilotSettings` for a stored file. */
export function isRavenAutopilotSettings(value: unknown): value is RavenAutopilotSettings {
  if (!isDynamicRecord(value)) return false;
  const overrides = value.overrides;
  const pickUp = value.pickUp;
  const merge = value.reviewerMerge;
  const mergeTypes = isDynamicRecord(merge) ? merge.types : null;
  return (
    typeof value.enabled === "boolean" &&
    typeof value.autoStack === "boolean" &&
    isDynamicRecord(overrides) &&
    RAVEN_AUTOPILOT_TICKET_TYPES.every((type) => overrides[type] === null || isOverride(overrides[type])) &&
    isDynamicRecord(pickUp) &&
    isOneOf(RAVEN_AUTOPILOT_PICK_UP_COLUMNS, pickUp.column) &&
    isOneOf(RAVEN_AUTOPILOT_PICK_UP_ASSIGNEES, pickUp.assignee) &&
    integerInRange(value.ticketsAtOnce, RAVEN_AUTOPILOT_TICKETS_AT_ONCE.min, RAVEN_AUTOPILOT_TICKETS_AT_ONCE.max) &&
    integerInRange(value.roundCap, RAVEN_AUTOPILOT_ROUND_CAP.min, RAVEN_AUTOPILOT_ROUND_CAP.max) &&
    typeof value.pauseOnUsageLimit === "boolean" &&
    isDynamicRecord(merge) &&
    typeof merge.enabled === "boolean" &&
    isDynamicRecord(mergeTypes) &&
    RAVEN_AUTOPILOT_TICKET_TYPES.every((type) => typeof mergeTypes[type] === "boolean") &&
    isOneOf(RAVEN_AUTOPILOT_MERGE_METHODS, merge.method) &&
    typeof value.notifyOnMerge === "boolean"
  );
}

/** One role of a decision: the role and the model that Raven picked for it. */
export interface RavenAutopilotDecisionRole {
  roleId: string;
  label: string;
  model: string;
}

/**
 * Why Autopilot started a job the way it did. The engine (#196) saves it on the job when it picks the
 * ticket up; the Autopilot tab shows the newest ones and the ticket shows its own. A later override does
 * not change it.
 */
export interface RavenAutopilotDecision {
  /** The board ticket id, or null for a job that did not come from the board. */
  ticketId: string | null;
  ticketTitle: string;
  ticketType: RavenAutopilotTicketType | null;
  stack: RavenAutopilotStack;
  /** The Raven team template of the job. Null for a stack that has no Raven team template. */
  templateId: string | null;
  playbook: string | null;
  roles: RavenAutopilotDecisionRole[];
  /** One or two plain sentences: why this stack and these models. */
  reason: string;
  /** `auto`: Raven picked. `override`: the user's fixed choice for the ticket type. */
  source: "auto" | "override";
  decidedAt: string;
  /**
   * The engine's (#196) code of the reason, so each language shows its own sentence. `reason` keeps the
   * English sentence for a reader that does not know the code. Absent on a decision from an older build.
   */
  reasonCode?: RavenAutopilotReasonCode;
  /** How big the engine thinks the change is, from the ticket and the repository. */
  changeSize?: RavenAutopilotChangeSize;
  /** How many files the ticket names. Null when it names none. */
  files?: number | null;
  /** The repository or project of the ticket, such as `owner/repo`. Null when it is not known. */
  repo?: string | null;
  /** The model class of the decision: strong models for big work, small ones for a chore. */
  modelTier?: RavenAutopilotModelTier;
  /** Every change of model or stack after a failed round, oldest first. */
  switches?: RavenAutopilotDecisionSwitch[];
}

export const RAVEN_AUTOPILOT_CHANGE_SIZES = ["small", "medium", "large"] as const;
export type RavenAutopilotChangeSize = (typeof RAVEN_AUTOPILOT_CHANGE_SIZES)[number];

export const RAVEN_AUTOPILOT_MODEL_TIERS = ["strong", "standard", "small"] as const;
export type RavenAutopilotModelTier = (typeof RAVEN_AUTOPILOT_MODEL_TIERS)[number];

/** Why the engine chose the stack. The ticket shows the sentence of the code, with the file count. */
export const RAVEN_AUTOPILOT_REASON_CODES = [
  "feature-large",
  "feature-small",
  "bug-failing-case",
  "bug-investigate",
  "chore-small",
  "override",
  "manual-stack",
  "pstack-missing",
] as const;
export type RavenAutopilotReasonCode = (typeof RAVEN_AUTOPILOT_REASON_CODES)[number];

/** The most switches that one decision keeps. */
export const RAVEN_AUTOPILOT_SWITCH_LIMIT = 20;

/** A change of model or stack after a failed round. The role keeps its agent and thread. */
export interface RavenAutopilotDecisionSwitch {
  /** The FAIL round after which the job switched. */
  round: number;
  roleId: string;
  /** `model`: the role moved to another model. `stack`: the job moved to another stack. */
  kind: "model" | "stack";
  from: string;
  to: string;
  at: string;
}

function isDecisionSwitch(value: unknown): value is RavenAutopilotDecisionSwitch {
  return (
    isDynamicRecord(value) &&
    integerInRange(value.round, 0, 100) &&
    isIdentifier(value.roleId) &&
    (value.kind === "model" || value.kind === "stack") &&
    isBoundedString(value.from, MODEL_ID_LIMIT) &&
    isBoundedString(value.to, MODEL_ID_LIMIT) &&
    isBoundedString(value.at, 160)
  );
}

/** The optional engine fields of a decision: each one is absent or valid. */
function hasValidEngineFields(value: DynamicRecord): boolean {
  return (
    (value.reasonCode === undefined || isOneOf(RAVEN_AUTOPILOT_REASON_CODES, value.reasonCode)) &&
    (value.changeSize === undefined || isOneOf(RAVEN_AUTOPILOT_CHANGE_SIZES, value.changeSize)) &&
    (value.files === undefined || value.files === null || integerInRange(value.files, 0, 100_000)) &&
    (value.repo === undefined || isNullableBoundedString(value.repo, 300)) &&
    (value.modelTier === undefined || isOneOf(RAVEN_AUTOPILOT_MODEL_TIERS, value.modelTier)) &&
    (value.switches === undefined ||
      (Array.isArray(value.switches) &&
        value.switches.length <= RAVEN_AUTOPILOT_SWITCH_LIMIT &&
        value.switches.every(isDecisionSwitch)))
  );
}

export const RAVEN_AUTOPILOT_REASON_LIMIT = 600;
export const RAVEN_AUTOPILOT_TITLE_LIMIT = 300;

export function isRavenAutopilotDecision(value: unknown): value is RavenAutopilotDecision {
  return (
    isDynamicRecord(value) &&
    (value.ticketId === null || isIdentifier(value.ticketId)) &&
    isBoundedString(value.ticketTitle, RAVEN_AUTOPILOT_TITLE_LIMIT) &&
    (value.ticketType === null || isOneOf(RAVEN_AUTOPILOT_TICKET_TYPES, value.ticketType)) &&
    isOneOf(RAVEN_AUTOPILOT_STACKS, value.stack) &&
    (value.templateId === null || isIdentifier(value.templateId)) &&
    isNullableBoundedString(value.playbook, 40) &&
    Array.isArray(value.roles) &&
    value.roles.length <= 12 &&
    value.roles.every(
      (role) =>
        isDynamicRecord(role) &&
        isString(role.roleId) &&
        isBoundedString(role.label, 40) &&
        isBoundedString(role.model, MODEL_ID_LIMIT),
    ) &&
    isBoundedString(value.reason, RAVEN_AUTOPILOT_REASON_LIMIT) &&
    (value.source === "auto" || value.source === "override") &&
    isString(value.decidedAt) &&
    hasValidEngineFields(value)
  );
}
