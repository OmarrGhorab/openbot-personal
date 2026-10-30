import {
  type AgentModelId,
  type AgentProviderId,
  isAgentProvider,
  isRavenAutopilotDecision,
  isRavenTeamQuestion,
  isRavenTeamRoleAccess,
  isRavenTeamRoleDefinition,
  RAVEN_TEAM_ROLE_STATES,
  RAVEN_TEAM_ROUND_CAP,
  RAVEN_TEAM_VERDICTS,
  type RavenAutopilotDecision,
  type RavenTeamJob,
  type RavenTeamJobState,
  type RavenTeamQuestion,
  type RavenTeamRoleAccess,
  type RavenTeamRoleDefinition,
  type RavenTeamRoleRun,
  type RavenTeamRoleState,
  type RavenTeamTemplate,
  type RavenTeamVerdict,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import {
  databaseRow,
  databaseRows,
  optionalNumberColumn,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/** A role of a job, with what the runtime keeps beside the public run. */
export interface RavenTeamRoleRecord extends RavenTeamRoleRun {
  skills: string[];
  /** The last handoff that the runtime sent and that no turn has started yet. */
  pendingMessage: string | null;
  /** How many times the runtime asked this role for its report line. */
  reminders: number;
}

export interface RavenTeamJobRecord extends Omit<RavenTeamJob, "roles" | "queued" | "decision"> {
  roles: RavenTeamRoleRecord[];
  /** What Autopilot chose for the job (migration 53). Null for a job that the person started. */
  decision: RavenAutopilotDecision | null;
}

/**
 * Whether a job waits for a free slot. The service holds back the first message of a job whose role
 * agents are full, so a running job with no question and no work thread on any role is queued. It is
 * derived from the stored job, so it needs no column and no migration.
 */
export function ravenTeamJobQueued(record: RavenTeamJobRecord): boolean {
  return record.state === "running" && record.question === null && record.roles.every((role) => role.taskId === null);
}

export function publicRavenTeamJob(record: RavenTeamJobRecord): RavenTeamJob {
  return {
    ...record,
    queued: ravenTeamJobQueued(record),
    roles: record.roles.map(({ skills: _skills, pendingMessage: _pending, reminders: _reminders, ...run }) => run),
  };
}

export interface RavenTeamJobPatch {
  state?: RavenTeamJobState;
  headCommit?: string | null;
  fixRounds?: number;
  fallbackModel?: AgentModelId | null;
  question?: RavenTeamQuestion | null;
  decision?: RavenAutopilotDecision | null;
}

export interface RavenTeamRolePatch {
  label?: string;
  agentId?: string | null;
  taskId?: string | null;
  threadId?: string | null;
  provider?: AgentProviderId;
  model?: AgentModelId;
  access?: RavenTeamRoleAccess;
  state?: RavenTeamRoleState;
  verdict?: RavenTeamVerdict | null;
  score?: number | null;
  commit?: string | null;
  fails?: number;
  reminders?: number;
  pendingMessage?: string | null;
  skills?: string[];
}

/**
 * Owns the `raven_team_*` tables (migrations 48 and 53). The built-in template is code and has no row. A job
 * keeps its own copy of each role's skills, provider and model, so a later template change does not
 * alter a running job. Every write stamps `updated_at`, which the view reads as the last activity.
 */
export class RavenTeamStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  listUserTemplates(): RavenTeamTemplate[] {
    return databaseRows(
      this.#database.connection.prepare("SELECT * FROM raven_team_templates ORDER BY name, template_id").all(),
    ).map(decodeTemplate);
  }

  findUserTemplate(templateId: string): RavenTeamTemplate | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM raven_team_templates WHERE template_id = ?").get(templateId),
    );
    return row ? decodeTemplate(row) : null;
  }

  saveUserTemplate(template: RavenTeamTemplate): void {
    this.#database.connection
      .prepare(
        `INSERT INTO raven_team_templates (template_id, name, roles_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(template_id) DO UPDATE SET
           name = excluded.name,
           roles_json = excluded.roles_json,
           updated_at = excluded.updated_at`,
      )
      .run(template.id, template.name, JSON.stringify(template.roles), template.createdAt, template.updatedAt);
  }

  deleteUserTemplate(templateId: string): void {
    this.#database.connection.prepare("DELETE FROM raven_team_templates WHERE template_id = ?").run(templateId);
  }

  /** Writes a job and its roles in one transaction. A caller already in one keeps it. */
  insertJob(job: RavenTeamJobRecord): void {
    const db = this.#database.connection;
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `INSERT INTO raven_team_jobs
           (job_id, template_id, brief, state, head_commit, fix_rounds, question_json, fallback_model, decision_json,
            round_cap, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        job.id,
        job.templateId,
        job.brief,
        job.state,
        job.headCommit,
        job.fixRounds,
        job.question ? JSON.stringify(job.question) : null,
        job.fallbackModel,
        job.decision ? JSON.stringify(job.decision) : null,
        job.roundCap === RAVEN_TEAM_ROUND_CAP ? null : job.roundCap,
        job.createdAt,
        job.updatedAt,
      );
      for (const role of job.roles) {
        db.prepare(
          `INSERT INTO raven_team_roles
             (job_id, role_id, label, skills_json, agent_id, task_id, thread_id, provider, model, access, state,
              verdict, score, commit_sha, fails, reminders, pending_message, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          job.id,
          role.roleId,
          role.label,
          JSON.stringify(role.skills),
          role.agentId,
          role.taskId,
          role.threadId,
          role.provider,
          role.model,
          role.access,
          role.state,
          role.verdict,
          role.score,
          role.commit,
          role.fails,
          role.reminders,
          role.pendingMessage,
          role.updatedAt,
        );
      }
      if (ownsTransaction) db.exec("COMMIT");
    } catch (error) {
      if (ownsTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  findJob(jobId: string): RavenTeamJobRecord | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM raven_team_jobs WHERE job_id = ?").get(jobId),
    );
    return row ? this.#withRoles(row) : null;
  }

  /** The newest jobs first. A view shows a bounded number. */
  listJobs(limit: number): RavenTeamJobRecord[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT * FROM raven_team_jobs ORDER BY created_at DESC, job_id LIMIT ?")
        .all(limit),
    ).map((row) => this.#withRoles(row));
  }

  updateJob(jobId: string, patch: RavenTeamJobPatch, now: string): void {
    const assignments: string[] = ["updated_at = ?"];
    const values: (string | number | null)[] = [now];
    if (patch.state !== undefined) {
      assignments.push("state = ?");
      values.push(patch.state);
    }
    if (patch.headCommit !== undefined) {
      assignments.push("head_commit = ?");
      values.push(patch.headCommit);
    }
    if (patch.fixRounds !== undefined) {
      assignments.push("fix_rounds = ?");
      values.push(patch.fixRounds);
    }
    if (patch.fallbackModel !== undefined) {
      assignments.push("fallback_model = ?");
      values.push(patch.fallbackModel);
    }
    if (patch.question !== undefined) {
      assignments.push("question_json = ?");
      values.push(patch.question ? JSON.stringify(patch.question) : null);
    }
    if (patch.decision !== undefined) {
      assignments.push("decision_json = ?");
      values.push(patch.decision ? JSON.stringify(patch.decision) : null);
    }
    this.#database.connection
      .prepare(`UPDATE raven_team_jobs SET ${assignments.join(", ")} WHERE job_id = ?`)
      .run(...values, jobId);
  }

  updateRole(jobId: string, roleId: string, patch: RavenTeamRolePatch, now: string): void {
    const columns: [keyof RavenTeamRolePatch, string][] = [
      ["label", "label"],
      ["agentId", "agent_id"],
      ["taskId", "task_id"],
      ["threadId", "thread_id"],
      ["provider", "provider"],
      ["model", "model"],
      ["access", "access"],
      ["state", "state"],
      ["verdict", "verdict"],
      ["score", "score"],
      ["commit", "commit_sha"],
      ["fails", "fails"],
      ["reminders", "reminders"],
      ["pendingMessage", "pending_message"],
    ];
    const assignments = ["updated_at = ?"];
    const values: (string | number | null)[] = [now];
    for (const [key, column] of columns) {
      const value = patch[key];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(typeof value === "string" || typeof value === "number" ? value : null);
    }
    if (patch.skills !== undefined) {
      assignments.push("skills_json = ?");
      values.push(JSON.stringify(patch.skills));
    }
    this.#database.connection
      .prepare(`UPDATE raven_team_roles SET ${assignments.join(", ")} WHERE job_id = ? AND role_id = ?`)
      .run(...values, jobId, roleId);
  }

  /** The job and role that a work thread belongs to, or null when no team role uses the thread. */
  findRoleByThread(threadId: string): { jobId: string; roleId: string } | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT job_id, role_id FROM raven_team_roles WHERE thread_id = ? ORDER BY updated_at DESC LIMIT 1")
        .get(threadId),
    );
    return row ? { jobId: requiredStringColumn(row, "job_id"), roleId: requiredStringColumn(row, "role_id") } : null;
  }

  #withRoles(row: DynamicRecord): RavenTeamJobRecord {
    const jobId = requiredStringColumn(row, "job_id");
    const roles = databaseRows(
      this.#database.connection.prepare("SELECT * FROM raven_team_roles WHERE job_id = ? ORDER BY rowid").all(jobId),
    ).map(decodeRole);
    const questionJson = optionalStringColumn(row, "question_json");
    const decisionJson = optionalStringColumn(row, "decision_json");
    return {
      id: jobId,
      templateId: requiredStringColumn(row, "template_id"),
      brief: requiredStringColumn(row, "brief"),
      state: decodeJobState(requiredStringColumn(row, "state")),
      headCommit: optionalStringColumn(row, "head_commit"),
      fixRounds: requiredNumberColumn(row, "fix_rounds"),
      roundCap: optionalNumberColumn(row, "round_cap") ?? RAVEN_TEAM_ROUND_CAP,
      fallbackModel: optionalStringColumn(row, "fallback_model"),
      question: questionJson ? decodeQuestion(JSON.parse(questionJson)) : null,
      roles,
      decision: decisionJson ? decodeDecision(JSON.parse(decisionJson)) : null,
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }
}

function isRoleDefinitionList(value: unknown): value is RavenTeamRoleDefinition[] {
  return Array.isArray(value) && value.every(isRavenTeamRoleDefinition);
}

function decodeTemplate(row: DynamicRecord): RavenTeamTemplate {
  const roles = JSON.parse(requiredStringColumn(row, "roles_json"));
  if (!isRoleDefinitionList(roles)) throw new Error("A stored Raven Stack team template is not valid.");
  return {
    id: requiredStringColumn(row, "template_id"),
    name: requiredStringColumn(row, "name"),
    builtIn: false,
    roles,
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
}

function decodeRole(row: DynamicRecord): RavenTeamRoleRecord {
  const skills = JSON.parse(requiredStringColumn(row, "skills_json"));
  if (!Array.isArray(skills) || !skills.every(isString)) throw new Error("A stored Raven Stack role is not valid.");
  const provider = requiredStringColumn(row, "provider");
  if (!isAgentProvider(provider)) throw new Error("A stored Raven Stack role has an unknown provider.");
  const access = requiredStringColumn(row, "access");
  if (!isRavenTeamRoleAccess(access)) throw new Error("A stored Raven Stack role has an unknown access.");
  const state = requiredStringColumn(row, "state");
  if (!isOneOf(RAVEN_TEAM_ROLE_STATES, state)) throw new Error("A stored Raven Stack role has an unknown state.");
  const verdict = optionalStringColumn(row, "verdict");
  if (verdict !== null && !isOneOf(RAVEN_TEAM_VERDICTS, verdict)) {
    throw new Error("A stored Raven Stack role has an unknown verdict.");
  }
  return {
    roleId: requiredStringColumn(row, "role_id"),
    label: requiredStringColumn(row, "label"),
    skills,
    agentId: optionalStringColumn(row, "agent_id"),
    taskId: optionalStringColumn(row, "task_id"),
    threadId: optionalStringColumn(row, "thread_id"),
    provider,
    model: requiredStringColumn(row, "model"),
    access,
    state,
    verdict,
    score: optionalNumberColumn(row, "score"),
    commit: optionalStringColumn(row, "commit_sha"),
    fails: requiredNumberColumn(row, "fails"),
    reminders: requiredNumberColumn(row, "reminders"),
    pendingMessage: optionalStringColumn(row, "pending_message"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
}

function decodeJobState(value: string): RavenTeamJobState {
  if (
    value === "running" ||
    value === "stopped" ||
    value === "waiting-user" ||
    value === "done" ||
    value === "not-done"
  ) {
    return value;
  }
  throw new Error(`Unknown Raven Stack job state: ${value}`);
}

/** A decision that no longer decodes, for example from a newer build, reads as none: the job still runs. */
function decodeDecision(value: unknown): RavenAutopilotDecision | null {
  return isRavenAutopilotDecision(value) ? value : null;
}

function decodeQuestion(value: unknown): RavenTeamQuestion {
  if (!isRavenTeamQuestion(value)) throw new Error("A stored Raven Stack question is not valid.");
  return value;
}
