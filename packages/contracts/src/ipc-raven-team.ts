import { type AgentModelId, type AgentReasoningEffort, isAgentModel, isReasoningEffort } from "./ipc-agent-identity";
import { type AgentProviderId, isAgentProvider } from "./ipc-agent-status";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isRavenAutopilotDecision, type RavenAutopilotDecision } from "./ipc-raven-autopilot";
import { type DynamicRecord, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * A Raven Stack team: one agent per role, each on the model the user names for that role. The team
 * runs on this computer. A template says which roles exist, which Raven Stack skills each role runs,
 * the default model of each role, and whether the role may write to the branch.
 *
 * "Teammate" and "group" are prompt and UI words only. The types here are `RavenTeam*`.
 */
export const RAVEN_TEAM_ROLE_ACCESS = ["read-only", "write"] as const;
export type RavenTeamRoleAccess = (typeof RAVEN_TEAM_ROLE_ACCESS)[number];

export const RAVEN_TEAM_ROLE_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
export const RAVEN_TEAM_SKILL_PATTERN = /^[a-z][a-z-]{0,39}$/;
export const RAVEN_TEAM_TEMPLATE_ROLE_LIMIT = 12;
export const RAVEN_TEAM_TEMPLATE_SKILL_LIMIT = 12;
export const RAVEN_TEAM_TEMPLATE_NAME_LIMIT = 80;
export const RAVEN_TEAM_BRIEF_LIMIT = 8_000;
/** A fix round is one Builder pass after a FAIL. The job stops at this count, as Raven Stack does. */
export const RAVEN_TEAM_ROUND_CAP = 3;
/** The FAIL count of the Builder that makes the job ask the user for a stronger model. */
export const RAVEN_TEAM_ESCALATE_AFTER_FAILS = 2;

export interface RavenTeamRoleDefinition {
  /** A stable id, such as `builder`. A message names the role with it or with its label. */
  id: string;
  /** The name the role shows in the UI. */
  label: string;
  /** Raven Stack skill names the role runs, without the `raven-stack-` prefix. */
  skills: string[];
  /** The model the role uses when the message names none. Null: the app's default model. */
  defaultModel: AgentModelId | null;
  /** `read-only`: the role must not change the branch. Only the `write` role pushes. */
  access: RavenTeamRoleAccess;
  /** An optional role starts only when the message names its model. */
  optional: boolean;
}

export interface RavenTeamTemplate {
  id: string;
  name: string;
  /** Built-in templates are read-only. A user copies one and changes the copy. */
  builtIn: boolean;
  roles: RavenTeamRoleDefinition[];
  createdAt: string;
  updatedAt: string;
}

export const RAVEN_STACK_TEAM_TEMPLATE_ID = "raven-stack-team";

/** The built-in template. Every role uses the app's default model until the message names one. */
export const RAVEN_STACK_TEAM_ROLES: readonly RavenTeamRoleDefinition[] = [
  {
    id: "architect",
    label: "Architect",
    skills: ["detect", "plan"],
    defaultModel: null,
    access: "read-only",
    optional: false,
  },
  {
    id: "builder",
    label: "Builder",
    skills: ["worktree", "before-evidence", "build", "gates", "after-evidence", "pr", "ci", "fix-round"],
    defaultModel: null,
    access: "write",
    optional: false,
  },
  { id: "reviewer", label: "Reviewer", skills: ["verify"], defaultModel: null, access: "read-only", optional: false },
  { id: "quality", label: "Quality", skills: ["quality"], defaultModel: null, access: "read-only", optional: false },
  { id: "editor", label: "Editor", skills: ["unslop"], defaultModel: null, access: "write", optional: true },
];

/**
 * The built-in Autopilot lite template, for small tickets. It has no Architect: the Builder plans in its
 * own turn, then the Reviewer gives the verdict. It has no Quality and no Editor. The FAIL rounds, the
 * fallback model, the stop and the resume work as in the full template.
 */
export const RAVEN_STACK_LITE_TEMPLATE_ID = "raven-stack-lite";

export const RAVEN_STACK_LITE_ROLES: readonly RavenTeamRoleDefinition[] = [
  {
    id: "builder",
    label: "Builder",
    skills: [
      "detect",
      "worktree",
      "plan",
      "before-evidence",
      "build",
      "gates",
      "after-evidence",
      "pr",
      "ci",
      "fix-round",
    ],
    defaultModel: null,
    access: "write",
    optional: false,
  },
  { id: "reviewer", label: "Reviewer", skills: ["verify"], defaultModel: null, access: "read-only", optional: false },
];

/** The ids of the built-in templates. They are code: a user can copy one, not change it. */
export const RAVEN_TEAM_BUILT_IN_TEMPLATE_IDS: readonly string[] = [
  RAVEN_STACK_TEAM_TEMPLATE_ID,
  RAVEN_STACK_LITE_TEMPLATE_ID,
];

export const RAVEN_TEAM_BUILDER_ROLE_ID = "builder";

/** The verdict a role reports. `DONE` is for a role that makes no verdict: the Architect and the Builder. */
export const RAVEN_TEAM_VERDICTS = ["DONE", "PASS", "PASS+NOTES", "FAIL", "BLOCKED"] as const;
export type RavenTeamVerdict = (typeof RAVEN_TEAM_VERDICTS)[number];

/** The states of one role in a job. */
export const RAVEN_TEAM_ROLE_STATES = [
  "waiting",
  "working",
  "reported",
  "passed",
  "failed",
  "blocked",
  "stopped",
] as const;
export type RavenTeamRoleState = (typeof RAVEN_TEAM_ROLE_STATES)[number];

export const RAVEN_TEAM_JOB_STATES = ["running", "stopped", "waiting-user", "done", "not-done"] as const;
export type RavenTeamJobState = (typeof RAVEN_TEAM_JOB_STATES)[number];

/** Why a job waits for the user. */
export const RAVEN_TEAM_QUESTIONS = [
  "fallback-model",
  "blocked",
  "unknown-model",
  "no-report",
  "workspace-access",
] as const;
export type RavenTeamQuestionKind = (typeof RAVEN_TEAM_QUESTIONS)[number];

/** The model of one role, from the message or from the template. */
export interface RavenTeamPlanRole {
  roleId: string;
  label: string;
  model: AgentModelId;
  provider: AgentProviderId;
  access: RavenTeamRoleAccess;
  skills: string[];
  optional: boolean;
  /** True when the message or the user named the model. False when the template default gave it. */
  named: boolean;
  /**
   * The agent access of the role's agent: true for Full access, false for Workspace only. A `write`
   * role always has Full access. A `read-only` role has it only when the user gave it, and its brief
   * still tells it not to change the branch.
   */
  fullAccess: boolean;
  /**
   * The reasoning effort of the role's turns: the one the user chose when the model supports it, else
   * the model's default. Null when the model has no effort levels. The role's agent takes it, the
   * same way an agent chat sends the effort with each turn.
   */
  reasoningEffort: AgentReasoningEffort | null;
}

export interface RavenTeamPlanWarning {
  kind: "same-model";
  roleId: string;
  /** The Builder role, whose model the role shares. */
  builderRoleId: string;
  model: AgentModelId;
}

/**
 * A read-only role whose provider cannot run Workspace only on this computer. Its agent would never
 * start a turn, so the plan cannot start until the user gives the role Full access or another model.
 */
export interface RavenTeamAccessProblem {
  roleId: string;
  provider: AgentProviderId;
  /** `process.platform` of the computer that runs the team. */
  platform: string;
}

export interface RavenTeamUnknownModel {
  roleId: string;
  model: string;
}

/**
 * What the confirm card shows before the start. A plan is ready to start when `unknownRoles`,
 * `unknownModels` and `accessProblems` are all empty and every role has a model.
 */
export interface RavenTeamPlan {
  templateId: string;
  brief: string;
  roles: RavenTeamPlanRole[];
  warnings: RavenTeamPlanWarning[];
  /** Role names in the message that the template does not have. */
  unknownRoles: string[];
  /** Models that the message or the user names and that no connected provider lists. */
  unknownModels: RavenTeamUnknownModel[];
  /** Read-only roles that cannot run Workspace only with their provider on this computer. */
  accessProblems: RavenTeamAccessProblem[];
  /** The stronger model the Builder moves to after two FAIL rounds. Null when the message names none. */
  fallbackModel: AgentModelId | null;
}

export interface RavenTeamRoleRun {
  roleId: string;
  label: string;
  agentId: string | null;
  taskId: string | null;
  threadId: string | null;
  provider: AgentProviderId;
  model: AgentModelId;
  access: RavenTeamRoleAccess;
  state: RavenTeamRoleState;
  /** The last verdict of the role. Null when it has not reported, or when a newer Builder commit made it stale. */
  verdict: RavenTeamVerdict | null;
  score: number | null;
  /** The commit that the role's last report names. Null when it names none. */
  commit: string | null;
  /** How many FAIL verdicts this role gave in this job. */
  fails: number;
  updatedAt: string;
}

export interface RavenTeamQuestion {
  kind: RavenTeamQuestionKind;
  roleId: string | null;
  /** `workspace-access` only: `process.platform` of the computer that cannot run the role Workspace only. */
  platform?: string;
}

export interface RavenTeamJob {
  id: string;
  templateId: string;
  brief: string;
  state: RavenTeamJobState;
  /**
   * True while a `running` job waits for a free slot: a role agent of the job already runs as many
   * jobs as its work-thread limit allows, so no role has a work thread yet. The service derives it from
   * the stored job; it is not a column. The job starts on its own when a slot frees.
   */
  queued: boolean;
  /** The commit of the last Builder report. Null before the first one. */
  headCommit: string | null;
  /** The number of FAIL rounds so far. Each one sends the findings to the Builder. */
  fixRounds: number;
  /** The job stops as `not-done` at this many FAIL rounds. */
  roundCap: number;
  /** The model the Builder moves to after two FAIL rounds. Null when the message named none. */
  fallbackModel: AgentModelId | null;
  question: RavenTeamQuestion | null;
  roles: RavenTeamRoleRun[];
  /**
   * Why Autopilot started the job with this stack, team and models. Absent or null for a job that the
   * user started on the Set up tab. The Autopilot engine (#196) sets it when it picks the ticket up.
   */
  decision?: RavenAutopilotDecision | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveRavenTeamTemplateInput {
  /** Absent: a new template. A built-in id is refused. */
  id?: string;
  name: string;
  roles: RavenTeamRoleDefinition[];
}

/** A plan, or the start of a job: the message and, optionally, the models the user chose for roles. */
export interface PlanRavenTeamInput {
  templateId: string;
  brief: string;
  /** Role id to model. Overrides a model that the message names for the same role. */
  models?: Record<string, string>;
  /** Ids of read-only roles that the user gave Full access on the confirm card. */
  fullAccess?: string[];
  /** Role id to reasoning effort. An effort the role's model does not support gives the model's default. */
  efforts?: Record<string, AgentReasoningEffort>;
  /**
   * Ids of roles that this job leaves out, such as the Architect for a small ticket. The Builder cannot be
   * left out. A skipped role that plans, such as the Architect, hands its skills to the Builder, so the
   * Builder plans in its own turn. A job with no Reviewer and no Quality is done when the Builder commits.
   */
  skippedRoles?: string[];
}

export interface SetRavenTeamRoleModelInput {
  jobId: string;
  roleId: string;
  model: string;
}

/** Gives one role of a job Full access, and sends the role the message that waited for it. */
export interface GiveRavenTeamRoleFullAccessInput {
  jobId: string;
  roleId: string;
}

/** The change event: the job that changed, or null when the template list changed. */
export interface RavenTeamChanged {
  jobId: string | null;
}

const PLATFORM_NAMES: Readonly<Record<string, string>> = { linux: "Linux", win32: "Windows", darwin: "macOS" };

/** The name of an operating system in the access question, or null for one the text does not name. */
export function ravenTeamPlatformName(platform: string): string | null {
  return Object.hasOwn(PLATFORM_NAMES, platform) ? (PLATFORM_NAMES[platform] ?? null) : null;
}

export function isRavenTeamRoleAccess(value: unknown): value is RavenTeamRoleAccess {
  return isOneOf(RAVEN_TEAM_ROLE_ACCESS, value);
}

export function isRavenTeamRoleDefinition(value: unknown): value is RavenTeamRoleDefinition {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    RAVEN_TEAM_ROLE_ID_PATTERN.test(value.id) &&
    isBoundedString(value.label, 40) &&
    Array.isArray(value.skills) &&
    value.skills.length <= RAVEN_TEAM_TEMPLATE_SKILL_LIMIT &&
    value.skills.every((skill) => isString(skill) && RAVEN_TEAM_SKILL_PATTERN.test(skill)) &&
    (value.defaultModel === null || isAgentModel(value.defaultModel)) &&
    isRavenTeamRoleAccess(value.access) &&
    typeof value.optional === "boolean"
  );
}

export function isRavenTeamTemplate(value: unknown): value is RavenTeamTemplate {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, RAVEN_TEAM_TEMPLATE_NAME_LIMIT) &&
    typeof value.builtIn === "boolean" &&
    Array.isArray(value.roles) &&
    value.roles.length > 0 &&
    value.roles.length <= RAVEN_TEAM_TEMPLATE_ROLE_LIMIT &&
    value.roles.every(isRavenTeamRoleDefinition) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

export function isRavenTeamRoleRun(value: unknown): value is RavenTeamRoleRun {
  return (
    isDynamicRecord(value) &&
    isString(value.roleId) &&
    isBoundedString(value.label, 40) &&
    (value.agentId === null || isIdentifier(value.agentId)) &&
    (value.taskId === null || isIdentifier(value.taskId)) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    isAgentProvider(value.provider) &&
    isAgentModel(value.model) &&
    isRavenTeamRoleAccess(value.access) &&
    isOneOf(RAVEN_TEAM_ROLE_STATES, value.state) &&
    (value.verdict === null || isOneOf(RAVEN_TEAM_VERDICTS, value.verdict)) &&
    (value.score === null || (isNumber(value.score) && Number.isInteger(value.score))) &&
    isNullableBoundedString(value.commit, 40) &&
    isNumber(value.fails) &&
    isString(value.updatedAt)
  );
}

export function isRavenTeamJob(value: unknown): value is RavenTeamJob {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.templateId) &&
    isBoundedString(value.brief, RAVEN_TEAM_BRIEF_LIMIT) &&
    isOneOf(RAVEN_TEAM_JOB_STATES, value.state) &&
    typeof value.queued === "boolean" &&
    isNullableBoundedString(value.headCommit, 40) &&
    isNumber(value.fixRounds) &&
    isNumber(value.roundCap) &&
    (value.fallbackModel === null || isAgentModel(value.fallbackModel)) &&
    (value.question === null || isRavenTeamQuestion(value.question)) &&
    Array.isArray(value.roles) &&
    value.roles.every(isRavenTeamRoleRun) &&
    (value.decision === undefined || value.decision === null || isRavenAutopilotDecision(value.decision)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

export function isRavenTeamQuestion(value: unknown): value is RavenTeamQuestion {
  return (
    isDynamicRecord(value) &&
    isOneOf(RAVEN_TEAM_QUESTIONS, value.kind) &&
    (value.roleId === null || isString(value.roleId)) &&
    (value.platform === undefined || isBoundedString(value.platform, 40))
  );
}

/**
 * The line that a role ends its final message with: `RAVEN-REPORT: {json}`. The parser reads the last
 * such line and ignores the text before it. A role that prints no line reports nothing, and the
 * runtime asks it once more.
 */
export function isRavenTeamPlan(value: unknown): value is RavenTeamPlan {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.templateId) &&
    isBoundedString(value.brief, RAVEN_TEAM_BRIEF_LIMIT) &&
    Array.isArray(value.roles) &&
    value.roles.every(
      (role) =>
        isDynamicRecord(role) &&
        isString(role.roleId) &&
        isBoundedString(role.label, 40) &&
        isAgentModel(role.model) &&
        isAgentProvider(role.provider) &&
        isRavenTeamRoleAccess(role.access) &&
        Array.isArray(role.skills) &&
        role.skills.every(isString) &&
        typeof role.optional === "boolean" &&
        typeof role.named === "boolean" &&
        typeof role.fullAccess === "boolean" &&
        (role.reasoningEffort === null || isReasoningEffort(role.reasoningEffort)),
    ) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.unknownRoles) &&
    value.unknownRoles.every(isString) &&
    Array.isArray(value.unknownModels) &&
    value.unknownModels.every(
      (unknown) => isDynamicRecord(unknown) && isString(unknown.roleId) && isString(unknown.model),
    ) &&
    Array.isArray(value.accessProblems) &&
    value.accessProblems.every(
      (problem) =>
        isDynamicRecord(problem) &&
        isString(problem.roleId) &&
        isAgentProvider(problem.provider) &&
        isBoundedString(problem.platform, 40),
    ) &&
    (value.fallbackModel === null || isAgentModel(value.fallbackModel))
  );
}

export function isRavenTeamChanged(value: unknown): value is RavenTeamChanged {
  return isDynamicRecord(value) && (value.jobId === null || isIdentifier(value.jobId));
}

export const RAVEN_TEAM_REPORT_PREFIX = "RAVEN-REPORT:";

export interface RavenTeamReport {
  verdict: RavenTeamVerdict;
  score: number | null;
  commit: string | null;
}

/** The report of a role from the last `RAVEN-REPORT:` line of its text, or null. */
export function parseRavenTeamReport(text: string): RavenTeamReport | null {
  const line = text
    .split("\n")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.startsWith(RAVEN_TEAM_REPORT_PREFIX))
    .at(-1);
  if (!line) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(RAVEN_TEAM_REPORT_PREFIX.length).trim());
  } catch {
    return null;
  }
  if (!isRavenTeamReportRecord(parsed)) return null;
  return {
    verdict: parsed.verdict,
    score: typeof parsed.score === "number" ? parsed.score : null,
    commit: typeof parsed.commit === "string" ? parsed.commit : null,
  };
}

function isRavenTeamReportRecord(
  value: unknown,
): value is DynamicRecord & { verdict: RavenTeamVerdict; score?: unknown; commit?: unknown } {
  return (
    isDynamicRecord(value) &&
    isOneOf(RAVEN_TEAM_VERDICTS, value.verdict) &&
    (value.score === undefined ||
      (isNumber(value.score) && Number.isInteger(value.score) && value.score >= 0 && value.score <= 10)) &&
    (value.commit === undefined || (isString(value.commit) && /^[0-9a-f]{7,40}$/.test(value.commit)))
  );
}
