import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentReasoningEffort,
  type GiveRavenTeamRoleFullAccessInput,
  isRavenTeamRoleDefinition,
  isReasoningEffort,
  type PlanRavenTeamInput,
  RAVEN_TEAM_BRIEF_LIMIT,
  RAVEN_TEAM_TEMPLATE_NAME_LIMIT,
  RAVEN_TEAM_TEMPLATE_ROLE_LIMIT,
  type RavenTeamRoleDefinition,
  type SaveRavenTeamTemplateInput,
  type SetRavenTeamRoleModelInput,
  TICKET_TAKE_TEXT_LIMIT,
  type TakeRavenTicketInput,
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

/** The `fullAccess` list of a plan: ids of read-only roles that the user gave Full access. */
function parseFullAccess(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > RAVEN_TEAM_TEMPLATE_ROLE_LIMIT) {
    throw new Error("Invalid team access choices.");
  }
  return [...new Set(value.map((roleId) => requireString(roleId, "roleId", INPUT_LIMITS.identifier)))];
}

/** The `skippedRoles` list of a plan: ids of the roles that the job leaves out. */
function parseSkippedRoles(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > RAVEN_TEAM_TEMPLATE_ROLE_LIMIT) {
    throw new Error("Invalid team skipped roles.");
  }
  return [...new Set(value.map((roleId) => requireString(roleId, "roleId", INPUT_LIMITS.identifier)))];
}

/** The `efforts` map of a plan: role id to a reasoning effort. */
function parseEfforts(value: unknown): Record<string, AgentReasoningEffort> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new Error("Invalid team effort choices.");
  const entries = Object.entries(value);
  if (entries.length > MAX_MODEL_OVERRIDES) throw new Error("Too many team effort choices.");
  return Object.fromEntries(
    entries.map(([roleId, effort]) => {
      if (!isReasoningEffort(effort)) throw new Error("Invalid team effort choice.");
      return [requireString(roleId, "roleId", INPUT_LIMITS.identifier), effort];
    }),
  );
}

export function parsePlanRavenTeam(value: unknown): PlanRavenTeamInput {
  if (!isObject(value)) throw new Error("Invalid team plan request.");
  const models = parseModelOverrides(value.models);
  const fullAccess = parseFullAccess(value.fullAccess);
  const efforts = parseEfforts(value.efforts);
  const skippedRoles = parseSkippedRoles(value.skippedRoles);
  return {
    templateId: parseRavenTemplateId(value.templateId),
    brief: requireString(value.brief, "brief", RAVEN_TEAM_BRIEF_LIMIT),
    ...(models ? { models } : {}),
    ...(fullAccess ? { fullAccess } : {}),
    ...(efforts ? { efforts } : {}),
    ...(skippedRoles ? { skippedRoles } : {}),
  };
}

export function parseGiveRavenRoleFullAccess(value: unknown): GiveRavenTeamRoleFullAccessInput {
  if (!isObject(value)) throw new Error("Invalid team role access request.");
  return {
    jobId: parseRavenJobId(value.jobId),
    roleId: requireString(value.roleId, "roleId", INPUT_LIMITS.identifier),
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

/** A chat take request (#200): the agent of the chat and the message. A longer message is cut, not refused. */
export function parseTakeRavenTicket(value: unknown): TakeRavenTicketInput {
  if (!isObject(value)) throw new Error("Invalid ticket take request.");
  if (typeof value.text !== "string" || value.text.trim() === "") throw new Error("Invalid ticket take message.");
  return {
    agentId: requireString(value.agentId, "agentId", INPUT_LIMITS.identifier),
    text: value.text.slice(0, TICKET_TAKE_TEXT_LIMIT),
  };
}
