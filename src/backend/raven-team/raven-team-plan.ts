import type { AgentProviderId, AgentReasoningEffort } from "@openbot/contracts/ipc";
import {
  type AgentModelOption,
  defaultProviderModel,
  RAVEN_TEAM_BUILDER_ROLE_ID,
  type RavenTeamAccessProblem,
  type RavenTeamPlan,
  type RavenTeamPlanRole,
  type RavenTeamPlanWarning,
  type RavenTeamRoleDefinition,
  type RavenTeamTemplate,
  type RavenTeamUnknownModel,
} from "@openbot/contracts/ipc";

/** One model id as a message writes it: a single token. A trailing full stop is the sentence's, not the id's. */
const MODEL_TOKEN = "[A-Za-z0-9][A-Za-z0-9._:/[\\],=+-]*";
/** The special name of the stronger Builder model, after two FAIL rounds. */
const FALLBACK_NAME = "fallback";
/** The key of `models` that names the fallback model in a plan input. */
export const FALLBACK_MODEL_KEY = FALLBACK_NAME;
/** Skills that make a role a verifier. A verifier must not run on the Builder's model when another exists. */
const VERIFIER_SKILLS = ["verify", "quality"] as const;

export interface RavenTeamNamedModels {
  /** Role id to the model that the message names for it. */
  models: Map<string, string>;
  fallbackModel: string | null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reads `<Role>: <model>` pairs from a message. Only the template's role labels and ids, and the word
 * `Fallback`, are read. A name that is not in the template is left out here: the plan reports it when
 * the user passes it in `models`, so no role is named silently.
 */
export function readRavenTeamNamedModels(
  text: string,
  roles: readonly RavenTeamRoleDefinition[],
): RavenTeamNamedModels {
  const names = [...new Set([...roles.flatMap((role) => [role.label, role.id]), FALLBACK_NAME])];
  const pattern = new RegExp(`(?<![A-Za-z0-9-])(${names.map(escapeRegExp).join("|")})\\s*:\\s*(${MODEL_TOKEN})`, "giu");
  const models = new Map<string, string>();
  let fallbackModel: string | null = null;
  for (const match of text.matchAll(pattern)) {
    const name = (match[1] ?? "").toLowerCase();
    const model = (match[2] ?? "").replace(/\.+$/u, "");
    if (!model) continue;
    if (name === FALLBACK_NAME) {
      fallbackModel = model;
      continue;
    }
    const role = roles.find(
      (candidate) => candidate.id.toLowerCase() === name || candidate.label.toLowerCase() === name,
    );
    if (role) models.set(role.id, model);
  }
  return { models, fallbackModel };
}

/** The model that a role uses when neither the message nor the template names one: the app's default. */
function appDefaultModel(models: readonly AgentModelOption[], provider: AgentProviderId): AgentModelOption | null {
  const preferred = defaultProviderModel(provider);
  return (
    models.find((model) => model.provider === provider && model.id === preferred) ??
    models.find((model) => model.provider === provider) ??
    models[0] ??
    null
  );
}

export interface BuildRavenTeamPlanInput {
  template: RavenTeamTemplate;
  brief: string;
  /** The `Role: model` pairs of the message. */
  named: RavenTeamNamedModels;
  /** Role id to model that the user chose, for example after a question. It overrides the message. */
  overrides: Record<string, string>;
  /** Every model that a connected provider lists. */
  models: readonly AgentModelOption[];
  preferredProvider: AgentProviderId;
  /** Ids of read-only roles that the user gave Full access. */
  fullAccess?: readonly string[];
  /** Role id to the reasoning effort that the user chose. */
  efforts?: Readonly<Record<string, AgentReasoningEffort>>;
  /** Ids of roles that the job leaves out. The Builder is never left out. */
  skippedRoles?: readonly string[];
  /** Whether a Workspace only agent of the provider can run on this computer. */
  workspaceOnlySupported: (provider: AgentProviderId) => boolean;
  /** `process.platform` of this computer, for the question. */
  platform: string;
}

/** Whether a role definition checks the Builder's work. */
function isVerifierRole(role: RavenTeamRoleDefinition): boolean {
  return role.skills.some((skill) => VERIFIER_SKILLS.some((verifier) => verifier === skill));
}

/**
 * The template without the roles that a job leaves out. The Builder stays. A role that only plans, such as
 * the Architect, hands its skills to the Builder, as Autopilot lite does, so the Builder plans in its own
 * turn. A role that checks the work, such as the Reviewer, leaves with its skills: nobody checks in its place.
 */
export function withoutSkippedRoles(template: RavenTeamTemplate, skipped: readonly string[]): RavenTeamTemplate {
  const left = new Set(skipped.filter((roleId) => roleId !== RAVEN_TEAM_BUILDER_ROLE_ID));
  if (left.size === 0) return template;
  const handed = template.roles
    .filter((role) => left.has(role.id) && !isVerifierRole(role))
    .flatMap((role) => role.skills);
  const roles = template.roles
    .filter((role) => !left.has(role.id))
    .map((role) =>
      role.id === RAVEN_TEAM_BUILDER_ROLE_ID ? { ...role, skills: [...new Set([...handed, ...role.skills])] } : role,
    );
  return { ...template, roles };
}

/**
 * The plan for a start: each role with its model, the warnings, and the names that cannot start. A
 * model that no provider lists is never swapped for another one: it goes into `unknownModels`, and the
 * caller asks the user. A read-only role whose provider cannot run Workspace only here goes into
 * `accessProblems`: its agent would never start a turn. The plan is ready to start when all three
 * lists are empty.
 */
export function buildRavenTeamPlan(input: BuildRavenTeamPlanInput): RavenTeamPlan {
  const { named, overrides, models } = input;
  const template = withoutSkippedRoles(input.template, input.skippedRoles ?? []);
  const requested = new Map(named.models);
  for (const [roleId, model] of Object.entries(overrides)) {
    if (roleId !== FALLBACK_MODEL_KEY && model.trim()) requested.set(roleId, model.trim());
  }
  // A role that the job leaves out is still a role of the template: naming its model is not a mistake.
  const roleIds = new Set(input.template.roles.map((role) => role.id));
  const unknownRoles = [...requested.keys()].filter((roleId) => !roleIds.has(roleId));
  const unknownModels: RavenTeamUnknownModel[] = [];
  const roles: RavenTeamPlanRole[] = [];
  const accessProblems: RavenTeamAccessProblem[] = [];
  const fullAccess = new Set(input.fullAccess ?? []);
  const appDefault = appDefaultModel(models, input.preferredProvider);

  for (const role of template.roles) {
    const chosen = requested.get(role.id) ?? null;
    if (role.optional && chosen === null) continue;
    const isNamed = chosen !== null;
    const modelId = chosen ?? role.defaultModel ?? appDefault?.id ?? null;
    if (modelId === null) {
      unknownModels.push({ roleId: role.id, model: "" });
      continue;
    }
    const option = models.find((candidate) => candidate.id === modelId);
    if (!option) {
      unknownModels.push({ roleId: role.id, model: modelId });
      continue;
    }
    const roleFullAccess = role.access === "write" || fullAccess.has(role.id);
    if (!roleFullAccess && !input.workspaceOnlySupported(option.provider)) {
      accessProblems.push({ roleId: role.id, provider: option.provider, platform: input.platform });
    }
    roles.push({
      roleId: role.id,
      label: role.label,
      model: option.id,
      provider: option.provider,
      access: role.access,
      skills: [...role.skills],
      optional: role.optional,
      named: isNamed,
      fullAccess: roleFullAccess,
      reasoningEffort: ravenTeamRoleEffort(option, input.efforts?.[role.id]),
    });
  }

  let fallbackModel: string | null = null;
  if (named.fallbackModel !== null || overrides[FALLBACK_MODEL_KEY]) {
    const wanted = (overrides[FALLBACK_MODEL_KEY] ?? named.fallbackModel ?? "").trim();
    if (wanted && models.some((candidate) => candidate.id === wanted)) fallbackModel = wanted;
    else if (wanted) unknownModels.push({ roleId: FALLBACK_MODEL_KEY, model: wanted });
  }

  return {
    templateId: template.id,
    brief: input.brief,
    roles,
    warnings: sameModelWarnings(roles),
    unknownRoles,
    unknownModels,
    accessProblems,
    fallbackModel,
  };
}

/**
 * The effort of a role on a model: the wanted one when the model supports it, else the model's default.
 * Null when the model has no effort levels, so the page hides the effort and the agent keeps its own.
 */
export function ravenTeamRoleEffort(
  option: Pick<
    AgentModelOption,
    "defaultReasoningEffort" | "supportedReasoningEfforts" | "reasoningEffortConfigurable"
  >,
  wanted: AgentReasoningEffort | undefined,
): AgentReasoningEffort | null {
  if (option.reasoningEffortConfigurable === false || option.supportedReasoningEfforts.length === 0) return null;
  if (wanted && option.supportedReasoningEfforts.includes(wanted)) return wanted;
  return option.defaultReasoningEffort;
}

/** A verifier on the Builder's model is a warning, because the two checks then share one model's blind spots. */
function sameModelWarnings(roles: readonly RavenTeamPlanRole[]): RavenTeamPlanWarning[] {
  const builder = roles.find((role) => role.roleId === RAVEN_TEAM_BUILDER_ROLE_ID);
  if (!builder) return [];
  return roles
    .filter((role) => role.skills.some((skill) => VERIFIER_SKILLS.some((verifier) => verifier === skill)))
    .filter((role) => role.model === builder.model)
    .map((role) => ({ kind: "same-model", roleId: role.roleId, builderRoleId: builder.roleId, model: role.model }));
}

/** Whether a plan can start: no name is unknown, every role can run its access, and every role has a model. */
export function ravenTeamPlanReady(plan: RavenTeamPlan): boolean {
  return (
    plan.unknownRoles.length === 0 &&
    plan.unknownModels.length === 0 &&
    plan.accessProblems.length === 0 &&
    plan.roles.length > 0
  );
}
