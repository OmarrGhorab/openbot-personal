import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isRavenTeamRoleDefinition,
  type PlanRavenTeamInput,
  RAVEN_TEAM_BRIEF_LIMIT,
  RAVEN_TEAM_TEMPLATE_NAME_LIMIT,
  RAVEN_TEAM_TEMPLATE_ROLE_LIMIT,
  type RavenTeamRoleDefinition,
  type SaveRavenTeamTemplateInput,
  type SetRavenTeamRoleModelInput,
} from "@openbot/contracts/ipc";
import { isObject, requireString } from "./validation";

const MODEL_MAX_LENGTH = 160;
const MAX_MODEL_OVERRIDES = 12;

export function parseRavenTemplateId(value: unknown): string {
  return requireString(value, "templateId", INPUT_LIMITS.identifier);
}

export function parseRavenJobId(value: unknown): string {
  return requireString(value, "jobId", INPUT_LIMITS.identifier);
}

export function parseSaveRavenTemplate(value: unknown): SaveRavenTeamTemplateInput {
  if (!isObject(value)) throw new Error("Invalid team template request.");
  if (!Array.isArray(value.roles) || value.roles.length === 0 || value.roles.length > RAVEN_TEAM_TEMPLATE_ROLE_LIMIT) {
    throw new Error("Invalid team template roles.");
  }
  if (!value.roles.every(isRavenTeamRoleDefinition)) throw new Error("Invalid team template role.");
  const roles: RavenTeamRoleDefinition[] = value.roles;
  return {
    ...(value.id === undefined ? {} : { id: parseRavenTemplateId(value.id) }),
    name: requireString(value.name, "name", RAVEN_TEAM_TEMPLATE_NAME_LIMIT),
    roles,
  };
}

/** The `models` map of a plan: role id to model id. Empty values are dropped by the runtime. */
function parseModelOverrides(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new Error("Invalid team model choices.");
  const entries = Object.entries(value);
  if (entries.length > MAX_MODEL_OVERRIDES) throw new Error("Too many team model choices.");
  return Object.fromEntries(
    entries.map(([roleId, model]) => [
      requireString(roleId, "roleId", INPUT_LIMITS.identifier),
      requireString(model, "model", MODEL_MAX_LENGTH),
    ]),
  );
}

export function parsePlanRavenTeam(value: unknown): PlanRavenTeamInput {
  if (!isObject(value)) throw new Error("Invalid team plan request.");
  const models = parseModelOverrides(value.models);
  return {
    templateId: parseRavenTemplateId(value.templateId),
    brief: requireString(value.brief, "brief", RAVEN_TEAM_BRIEF_LIMIT),
    ...(models ? { models } : {}),
  };
}

export function parseSetRavenRoleModel(value: unknown): SetRavenTeamRoleModelInput {
  if (!isObject(value)) throw new Error("Invalid team role model request.");
  return {
    jobId: parseRavenJobId(value.jobId),
    roleId: requireString(value.roleId, "roleId", INPUT_LIMITS.identifier),
    model: requireString(value.model, "model", MODEL_MAX_LENGTH),
  };
}
