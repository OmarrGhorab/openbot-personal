import { randomUUID } from "node:crypto";
import { agentProviderName, workspaceOnlySupported } from "@openbot/contracts/agent-providers";
import type { AgentEvent, AgentModelId, AgentProviderId, AgentReasoningEffort } from "@openbot/contracts/ipc";
import {
  agentTaskLimit,
  RAVEN_AUTOPILOT_SWITCH_LIMIT,
  type PlanRavenTeamInput,
  parseRavenTeamReport,
  RAVEN_STACK_LITE_ROLES,
  RAVEN_STACK_LITE_TEMPLATE_ID,
  RAVEN_STACK_TEAM_ROLES,
  RAVEN_STACK_TEAM_TEMPLATE_ID,
  RAVEN_TEAM_BUILDER_ROLE_ID,
  RAVEN_TEAM_BUILT_IN_TEMPLATE_IDS,
  RAVEN_TEAM_ESCALATE_AFTER_FAILS,
  RAVEN_TEAM_ROUND_CAP,
  type RavenAutopilotDecision,
  type RavenAutopilotDecisionSwitch,
  type RavenTeamJob,
  type RavenTeamPlan,
  type RavenTeamQuestion,
  type RavenTeamQuestionKind,
  type RavenTeamReport,
  type RavenTeamTemplate,
  type RavenTeamVerdict,
  ravenTeamPlatformName,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect, Schema, Semaphore } from "effect";
import type { AgentService } from "../agent-service";
import {
  commitHandoff,
  editorNotesHandoff,
  findingsHandoff,
  planHandoff,
  reportReminder,
  resumeNotice,
  roleBrief,
  staleCommitNotice,
} from "./raven-team-briefs";
import {
  buildRavenTeamPlan,
  FALLBACK_MODEL_KEY,
  ravenTeamPlanReady,
  readRavenTeamNamedModels,
} from "./raven-team-plan";
import {
  publicRavenTeamJob,
  type RavenTeamJobRecord,
  type RavenTeamRoleRecord,
  type RavenTeamStore,
  ravenTeamJobQueued,
} from "./raven-team-store";

const logger = createOpenBotLogger("raven-team");

/** The built-in template's date. It is code, so it does not change. */
const BUILT_IN_DATE = "2026-10-28T00:00:00.000Z";
/** The agent name of a role's agent. The model is in the name, so a role on another model is another agent. */
const ROLE_AGENT_NAME_LIMIT = 80;
/** The error code of a message that did not start a turn (`drain-scheduler.ts`). */
const DELIVERY_START_FAILED = "delivery_start_failed";
/** The message that starts a role agent's first turn. The role's work starts in a task. */
const ROLE_AGENT_GREETING = "Raven Stack team role. Wait for a task from the team.";
/** The jobs that the queue reads, newest first. */
const QUEUE_SCAN_LIMIT = 200;

/**
 * The agent name of a role's agent. The model is in the name, so a role on another model is another
 * agent. An effort other than the model's default is in the name too: two jobs that run the same role
 * on one model with two efforts do not share one agent, whose effort applies to every turn.
 */
function ravenRoleAgentName(
  label: string,
  model: AgentModelId,
  effort: AgentReasoningEffort | null,
  defaultEffort: AgentReasoningEffort | null,
): string {
  const suffix = effort !== null && effort !== defaultEffort ? `${model}, ${effort}` : model;
  return `Raven ${label} (${suffix})`.slice(0, ROLE_AGENT_NAME_LIMIT);
}

export class RavenTeamFailed extends Schema.TaggedError<RavenTeamFailed>()("RavenTeamFailed", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/** The agent operations the team uses. A narrow type, so the team does not hold the whole service. */
export type RavenTeamAgents = Pick<
  AgentService,
  | "listAgents"
  | "createAgent"
  | "updateAgent"
  | "startTask"
  | "sendMessage"
  | "pauseTask"
  | "resumeTask"
  | "stopTask"
  | "readTask"
  | "listModels"
  | "preferredProvider"
>;

const BUILT_IN_RAVEN_TEAM_TEMPLATE: RavenTeamTemplate = {
  id: RAVEN_STACK_TEAM_TEMPLATE_ID,
  name: "Raven Stack team",
  builtIn: true,
  roles: RAVEN_STACK_TEAM_ROLES.map((role) => ({ ...role, skills: [...role.skills] })),
  createdAt: BUILT_IN_DATE,
  updatedAt: BUILT_IN_DATE,
};

/** Autopilot lite: the Builder plans in its own turn, then the Reviewer gives the verdict. */
const BUILT_IN_RAVEN_TEAM_LITE_TEMPLATE: RavenTeamTemplate = {
  id: RAVEN_STACK_LITE_TEMPLATE_ID,
  name: "Autopilot lite",
  builtIn: true,
  roles: RAVEN_STACK_LITE_ROLES.map((role) => ({ ...role, skills: [...role.skills] })),
  createdAt: BUILT_IN_DATE,
  updatedAt: BUILT_IN_DATE,
};

export interface RavenTeamServiceOptions {
  store: RavenTeamStore;
  agents: RavenTeamAgents;
  /** Called after each change to a job or a template, so the view reads it again. */
  changed: (jobId: string | null) => void;
  now?: () => string;
  /** `process.platform` of this computer. A test sets another one. */
  platform?: string;
  /**
   * Whether a Workspace only agent of the provider can run here. Defaults to `workspaceOnlySupported`
   * on `platform`. A test sets it to stand for a provider that cannot.
   */
  workspaceOnlySupported?: (provider: AgentProviderId) => boolean;
}

function isVerifier(role: RavenTeamRoleRecord): boolean {
  return role.skills.includes("verify") || role.skills.includes("quality");
}

/** What Autopilot adds to a start: its decision and the round limit of its settings. */
export interface RavenTeamAutopilotStart {
  decision: RavenAutopilotDecision;
  roundCap: number;
}

function isTerminal(job: RavenTeamJobRecord): boolean {
  return job.state === "done" || job.state === "not-done";
}

/**
 * The Raven Stack team runtime: one job per ticket, one agent per role, one work thread per role.
 *
 * The runtime is the orchestrator. It starts each role, passes the output of one role to the next,
 * reads each verdict from the role's own report line, and decides the next step. A role never
 * approves its own commit: a verifier passes only on the head commit that the Builder reported. A new
 * Builder commit clears the old verdicts. Two FAIL rounds move the Builder to a stronger model, from
 * the message or from the user. At the round cap the job stops as `not-done`.
 *
 * Every state change is one locked operation, so a turn event and a user action never interleave.
 */
export class RavenTeamService {
  readonly #store: RavenTeamStore;
  readonly #agents: RavenTeamAgents;
  readonly #changed: (jobId: string | null) => void;
  readonly #now: () => string;
  readonly #platform: string;
  readonly #workspaceOnlySupported: (provider: AgentProviderId) => boolean;
  readonly #lock = Semaphore.makeUnsafe(1);

  constructor(options: RavenTeamServiceOptions) {
    this.#store = options.store;
    this.#agents = options.agents;
    this.#changed = options.changed;
    this.#now = options.now ?? (() => new Date().toISOString());
    const platform = options.platform ?? process.platform;
    this.#platform = platform;
    this.#workspaceOnlySupported =
      options.workspaceOnlySupported ?? ((provider) => workspaceOnlySupported(provider, platform));
  }

  /** The built-in templates first, the full one and then Autopilot lite, then the user's copies. */
  templates(): RavenTeamTemplate[] {
    return [BUILT_IN_RAVEN_TEAM_TEMPLATE, BUILT_IN_RAVEN_TEAM_LITE_TEMPLATE, ...this.#store.listUserTemplates()];
  }

  /** Saves a user template. A built-in template cannot be changed; a copy of it can. */
  saveTemplate(input: { id?: string; name: string; roles: RavenTeamTemplate["roles"] }): RavenTeamTemplate[] {
    if (input.id !== undefined && RAVEN_TEAM_BUILT_IN_TEMPLATE_IDS.includes(input.id)) {
      throw new Error(sourceText("error.agent.ravenTeam.builtInTemplate"));
    }
    const now = this.#now();
    const existing = input.id ? this.#store.findUserTemplate(input.id) : null;
    const template: RavenTeamTemplate = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name: input.name.trim(),
      builtIn: false,
      roles: input.roles.map((role) => ({ ...role, skills: [...role.skills] })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.#store.saveUserTemplate(template);
    this.#changed(null);
    return this.templates();
  }

  deleteTemplate(templateId: string): RavenTeamTemplate[] {
    if (RAVEN_TEAM_BUILT_IN_TEMPLATE_IDS.includes(templateId)) {
      throw new Error(sourceText("error.agent.ravenTeam.builtInTemplate"));
    }
    this.#store.deleteUserTemplate(templateId);
    this.#changed(null);
    return this.templates();
  }

  /**
   * The plan of a start, read only: the message's `Role: model` pairs, the template defaults, the
   * warnings, and the names that cannot start. Nothing is started and no agent is changed.
   */
  plan(input: PlanRavenTeamInput): RavenTeamPlan {
    return this.#planFor(input);
  }

  listJobs(): RavenTeamJob[] {
    return this.#store.listJobs(50).map(publicRavenTeamJob);
  }

  /** One job, or null when it is not stored. The Tickets board reads it after each change of the job. */
  job(jobId: string): RavenTeamJob | null {
    const record = this.#store.findJob(jobId);
    return record ? publicRavenTeamJob(record) : null;
  }

  /**
   * Starts a job from a confirmed plan. The plan is checked again here, so a stale card cannot start a bad model.
   * Autopilot passes its decision and round limit. They are stored with the job, so a later change of the
   * settings does not change a running job.
   */
  start(input: PlanRavenTeamInput, autopilot?: RavenTeamAutopilotStart): Effect.Effect<RavenTeamJob, RavenTeamFailed> {
    return this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const plan = this.#planFor(input);
        const unknownRole = plan.unknownRoles[0];
        if (unknownRole !== undefined) {
          return yield* new RavenTeamFailed({
            operation: "start team",
            cause: new Error(sourceText("error.agent.ravenTeam.unknownRole", { role: unknownRole })),
          });
        }
        const unknown = plan.unknownModels[0];
        if (unknown !== undefined) {
          return yield* new RavenTeamFailed({
            operation: "start team",
            cause: new Error(this.#unknownModelText(unknown.roleId, unknown.model)),
          });
        }
        const accessProblem = plan.accessProblems[0];
        if (accessProblem !== undefined) {
          const label = plan.roles.find((role) => role.roleId === accessProblem.roleId)?.label ?? accessProblem.roleId;
          return yield* new RavenTeamFailed({
            operation: "start team",
            cause: new Error(this.#workspaceAccessText(label, accessProblem.provider)),
          });
        }
        if (!ravenTeamPlanReady(plan)) {
          return yield* new RavenTeamFailed({
            operation: "start team",
            cause: new Error(sourceText("error.agent.ravenTeam.noModel", { role: "team" })),
          });
        }
        const now = this.#now();
        const jobId = randomUUID();
        const roles: RavenTeamRoleRecord[] = [];
        for (const role of plan.roles) {
          const agent = yield* this.#ensureRoleAgent(
            role.roleId,
            role.label,
            role.model,
            role.provider,
            role.fullAccess,
            role.reasoningEffort,
          );
          roles.push({
            roleId: role.roleId,
            label: role.label,
            skills: [...role.skills],
            agentId: agent.id,
            taskId: null,
            threadId: null,
            provider: agent.provider,
            model: agent.model,
            access: role.access,
            state: "waiting",
            verdict: null,
            score: null,
            commit: null,
            fails: 0,
            reminders: 0,
            pendingMessage: null,
            updatedAt: now,
          });
        }
        const record: RavenTeamJobRecord = {
          id: jobId,
          templateId: plan.templateId,
          brief: redactText(plan.brief),
          state: "running",
          headCommit: null,
          fixRounds: 0,
          roundCap: autopilot?.roundCap ?? RAVEN_TEAM_ROUND_CAP,
          fallbackModel: plan.fallbackModel,
          question: null,
          roles,
          decision: autopilot ? decisionWithModels(autopilot.decision, roles) : null,
          createdAt: now,
          updatedAt: now,
        };
        // A job whose role agents are full waits in the queue: it is stored with no work thread, and it
        // starts when a slot frees. The check reads the other jobs, so it runs before the insert.
        const free = this.#hasFreeSlot(roles);
        this.#store.insertJob(record);
        this.#changed(jobId);
        if (free) yield* this.#begin(jobId);
        return publicRavenTeamJob(this.#job(jobId));
      }),
    );
  }

  /** Changes the model of one role of a job. It applies from the role's next turn. */
  setRoleModel(input: { jobId: string; roleId: string; model: string }): Effect.Effect<RavenTeamJob, RavenTeamFailed> {
    return this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const job = this.#job(input.jobId);
        const role = job.roles.find((candidate) => candidate.roleId === input.roleId);
        if (!role) {
          return yield* new RavenTeamFailed({
            operation: "set role model",
            cause: new Error(sourceText("error.agent.ravenTeam.unknownRole", { role: input.roleId })),
          });
        }
        yield* this.#switchRoleModel(job.id, role.roleId, input.model);
        const question = job.question;
        if (question?.kind === "fallback-model" && question.roleId === role.roleId) {
          // The user chose the stronger model. The findings that were waiting go to the Builder now.
          this.#store.updateJob(job.id, { question: null, state: "running" }, this.#now());
          const pending = this.#job(job.id).roles.find((candidate) => candidate.roleId === role.roleId)?.pendingMessage;
          if (pending) yield* this.#deliver(job.id, role.roleId, pending);
        }
        // A model on a provider that runs Workspace only here answers the access question too.
        yield* this.#settleAccess(job.id);
        this.#changed(job.id);
        return publicRavenTeamJob(this.#job(job.id));
      }),
    );
  }

  /**
   * Gives one role Full access, from the access question of a running job. The role's brief still
   * says read-only; only the agent access changes, so its provider can start. The message that waited
   * for the access is sent now.
   */
  giveRoleFullAccess(input: { jobId: string; roleId: string }): Effect.Effect<RavenTeamJob, RavenTeamFailed> {
    return this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const job = this.#job(input.jobId);
        const role = job.roles.find((candidate) => candidate.roleId === input.roleId);
        if (!role?.agentId) {
          return yield* new RavenTeamFailed({
            operation: "give role full access",
            cause: new Error(sourceText("error.agent.ravenTeam.unknownRole", { role: input.roleId })),
          });
        }
        yield* this.#call("give role full access", this.#agents.updateAgent({ agentId: role.agentId, access: "full" }));
        yield* this.#settleAccess(job.id);
        this.#changed(job.id);
        return publicRavenTeamJob(this.#job(job.id));
      }),
    );
  }

  /** Stops the whole team: each role's queue is held, and each running turn is stopped. */
  stop(jobId: string): Effect.Effect<RavenTeamJob, RavenTeamFailed> {
    return this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const job = this.#job(jobId);
        if (isTerminal(job)) return publicRavenTeamJob(job);
        for (const role of job.roles) {
          if (!role.agentId || !role.taskId) continue;
          yield* this.#call("pause role", this.#agents.pauseTask({ agentId: role.agentId, taskId: role.taskId }));
          if (role.state === "working") {
            yield* this.#call("stop role", this.#agents.stopTask({ agentId: role.agentId, taskId: role.taskId }));
            this.#store.updateRole(job.id, role.roleId, { state: "stopped" }, this.#now());
          }
        }
        this.#store.updateJob(job.id, { state: "stopped" }, this.#now());
        this.#changed(job.id);
        // A stopped job holds no slot: a queued job can start in its place.
        yield* this.#startQueued();
        return publicRavenTeamJob(this.#job(job.id));
      }),
    );
  }

  /** Resumes the team: each queue is released, and each stopped role gets its pending message or a notice. */
  resume(jobId: string): Effect.Effect<RavenTeamJob, RavenTeamFailed> {
    return this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const job = this.#job(jobId);
        if (isTerminal(job) || job.state !== "stopped") return publicRavenTeamJob(job);
        const now = this.#now();
        this.#store.updateJob(job.id, { state: job.question ? "waiting-user" : "running" }, now);
        for (const role of job.roles) {
          if (!role.agentId || !role.taskId) continue;
          yield* this.#call("resume role", this.#agents.resumeTask({ agentId: role.agentId, taskId: role.taskId }));
        }
        for (const role of this.#job(job.id).roles) {
          if (role.state !== "stopped") continue;
          const text = role.pendingMessage ?? (role.taskId ? resumeNotice() : null);
          if (text) yield* this.#deliver(job.id, role.roleId, text);
          else this.#store.updateRole(job.id, role.roleId, { state: "waiting" }, now);
        }
        this.#changed(job.id);
        // A job stopped while it was queued goes back to the queue, and starts when a slot is free.
        yield* this.#startQueued();
        return publicRavenTeamJob(this.#job(job.id));
      }),
    );
  }

  /**
   * Starts each queued job that has a free slot now. The queue also moves on each turn end; the app calls
   * this once at its start, so a job that waited when the app quit starts with no event.
   */
  startQueuedJobs(): Effect.Effect<void> {
    return this.#guarded(this.#startQueued());
  }

  /** Reacts to an agent event. Only turn events of a team role matter; every other event is ignored. */
  notice(event: AgentEvent): Effect.Effect<void> {
    if (event.type === "agents-changed") return this.#guarded(this.#settleAllAccess());
    if (event.type === "error") {
      const agentId = event.agentId;
      if (event.code !== DELIVERY_START_FAILED || agentId === undefined) return Effect.void;
      return this.#guarded(this.#startFailed(agentId));
    }
    if (event.type !== "turn-started" && event.type !== "turn-completed") return Effect.void;
    return this.#guarded(
      Effect.gen({ self: this }, function* () {
        const found = this.#store.findRoleByThread(event.threadId);
        if (!found) return;
        if (event.type === "turn-started") {
          this.#store.updateRole(found.jobId, found.roleId, { pendingMessage: null }, this.#now());
          return;
        }
        yield* this.#turnCompleted(found.jobId, found.roleId, event.status);
        // A job that ended frees its slots for the queue.
        yield* this.#startQueued();
      }),
    );
  }

  /** One locked reaction to an agent event. A failure is logged; the event source never sees it. */
  #guarded(effect: Effect.Effect<void, RavenTeamFailed>): Effect.Effect<void> {
    return this.#lock
      .withPermit(effect)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("A Raven Stack team event failed.", { cause: String(error) })),
        ),
      );
  }

  // ---- internals ----

  /**
   * Whether a job with these roles can start now. Each role agent runs at most its work-thread limit of
   * jobs at once (`agentTaskLimit`). A job holds a slot of each of its role agents from its first message
   * until it ends or stops; a queued job holds none.
   */
  #hasFreeSlot(roles: readonly RavenTeamRoleRecord[], exceptJobId?: string): boolean {
    const holding = this.#store
      .listJobs(QUEUE_SCAN_LIMIT)
      .filter(
        (job) => job.id !== exceptJobId && !isTerminal(job) && job.state !== "stopped" && !ravenTeamJobQueued(job),
      );
    const agents = this.#agents.listAgents();
    for (const agentId of new Set(roles.flatMap((role) => (role.agentId === null ? [] : [role.agentId])))) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) continue;
      const used = holding.filter((job) => job.roles.some((role) => role.agentId === agentId)).length;
      if (used >= agentTaskLimit(agent)) return false;
    }
    return true;
  }

  /** The first message of a job: to the Architect, or to the Builder when the template has no Architect. */
  #begin(jobId: string) {
    const roles = this.#job(jobId).roles;
    const first =
      roles.find((role) => role.roleId === "architect") ??
      roles.find((role) => role.roleId === RAVEN_TEAM_BUILDER_ROLE_ID);
    if (!first) return Effect.void;
    return this.#engage(jobId, first.roleId, null).pipe(
      Effect.catch((error) => this.#blockRole(jobId, first.roleId, "blocked", error)),
    );
  }

  /** Starts each queued job, oldest first, while its role agents have a free slot. */
  #startQueued() {
    return Effect.gen({ self: this }, function* () {
      const queued = this.#store
        .listJobs(QUEUE_SCAN_LIMIT)
        .filter((job) => ravenTeamJobQueued(job))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      for (const job of queued) {
        if (!this.#hasFreeSlot(job.roles, job.id)) continue;
        yield* this.#begin(job.id);
        this.#changed(job.id);
      }
    });
  }

  #planFor(input: PlanRavenTeamInput): RavenTeamPlan {
    const template = this.templates().find((candidate) => candidate.id === input.templateId);
    if (!template) throw new Error(sourceText("error.agent.ravenTeam.templateNotFound"));
    const brief = input.brief.trim();
    if (!brief) throw new Error(sourceText("error.agent.ravenTeam.briefRequired"));
    return buildRavenTeamPlan({
      template,
      brief,
      named: readRavenTeamNamedModels(brief, template.roles),
      overrides: input.models ?? {},
      models: this.#agents.listModels(),
      preferredProvider: this.#agents.preferredProvider(),
      fullAccess: input.fullAccess ?? [],
      efforts: input.efforts ?? {},
      skippedRoles: input.skippedRoles ?? [],
      workspaceOnlySupported: this.#workspaceOnlySupported,
      platform: this.#platform,
    });
  }

  /** The access question: the role, its provider, and this computer's system when the text can name it. */
  #workspaceAccessText(label: string, provider: AgentProviderId): string {
    const os = ravenTeamPlatformName(this.#platform);
    const values = { role: label, provider: agentProviderName(provider) };
    return os
      ? sourceText("error.agent.ravenTeam.workspaceAccess", { ...values, os })
      : sourceText("error.agent.ravenTeam.workspaceAccessHere", values);
  }

  /**
   * Whether the role's agent is set to Workspace only on a provider that cannot run it here. The
   * agent is read now, so a change in the agent settings or of the role's model counts at once.
   */
  #cannotRunAccess(role: RavenTeamRoleRecord): boolean {
    if (!role.agentId) return false;
    const agent = this.#agents.listAgents().find((candidate) => candidate.id === role.agentId);
    if (!agent || !workspaceAccessEnforced(agent)) return false;
    return !this.#workspaceOnlySupported(agent.provider);
  }

  /**
   * The role waits for the user with the access question. Its message is kept as the pending
   * message, so a change of access sends it. Nothing reaches the provider, so no turn hangs.
   */
  #askAccess(jobId: string, roleId: string, pendingMessage: string | null): void {
    const now = this.#now();
    this.#store.updateRole(jobId, roleId, { state: "blocked", pendingMessage }, now);
    const job = this.#job(jobId);
    // One question at a time: a second role waits blocked, and is asked when the first one is answered.
    if (job.question?.kind !== "workspace-access" || job.question.roleId === roleId) {
      const question: RavenTeamQuestion = { kind: "workspace-access", roleId, platform: this.#platform };
      this.#store.updateJob(jobId, { state: job.state === "stopped" ? "stopped" : "waiting-user", question }, now);
    }
    this.#changed(jobId);
  }

  /**
   * Answers the access question when the role can run now: after Full access, after a model on
   * another provider, or after a change in the agent settings. The waiting message is sent again.
   */
  #settleAccess(jobId: string) {
    return Effect.gen({ self: this }, function* () {
      const job = this.#job(jobId);
      const question = job.question;
      if (question?.kind !== "workspace-access" || question.roleId === null || isTerminal(job)) return;
      const role = job.roles.find((candidate) => candidate.roleId === question.roleId);
      if (!role || this.#cannotRunAccess(role)) return;
      const now = this.#now();
      const stopped = job.state === "stopped";
      this.#store.updateJob(jobId, { question: null, state: stopped ? "stopped" : "running" }, now);
      if (stopped) {
        // A stopped team sends the message at its resume.
        this.#store.updateRole(jobId, role.roleId, { state: "stopped" }, now);
      } else if (role.pendingMessage) {
        yield* this.#deliver(jobId, role.roleId, role.pendingMessage);
      } else {
        yield* this.#engage(jobId, role.roleId, null);
      }
      // The next role that waits on the same question is asked now.
      const next = this.#job(jobId).roles.find(
        (candidate) =>
          candidate.roleId !== role.roleId &&
          candidate.state === "blocked" &&
          candidate.pendingMessage !== null &&
          this.#cannotRunAccess(candidate),
      );
      if (next) this.#askAccess(jobId, next.roleId, next.pendingMessage);
      this.#changed(jobId);
    });
  }

  /** An agent changed: each job that waits on the access question checks its role again. */
  #settleAllAccess() {
    return Effect.gen({ self: this }, function* () {
      for (const job of this.#store.listJobs(50)) {
        if (job.question?.kind === "workspace-access") yield* this.#settleAccess(job.id);
      }
    });
  }

  /**
   * A message to a role's agent did not start. The role would show Working with no turn, so it asks
   * the user: the access question when its provider cannot run Workspace only here, the blocked
   * question otherwise. Only a role whose message has not started a turn is matched.
   */
  #startFailed(agentId: string) {
    return Effect.sync(() => {
      for (const job of this.#store.listJobs(50)) {
        if (isTerminal(job) || job.state === "stopped") continue;
        for (const role of job.roles) {
          if (role.agentId !== agentId || role.state !== "working" || role.pendingMessage === null) continue;
          if (this.#cannotRunAccess(role)) this.#askAccess(job.id, role.roleId, role.pendingMessage);
          else this.#blockedAt(job.id, role.roleId, "blocked");
        }
      }
    });
  }

  #unknownModelText(roleId: string, model: string): string {
    if (roleId === FALLBACK_MODEL_KEY) return sourceText("error.agent.ravenTeam.unknownFallback", { model });
    return sourceText("error.agent.ravenTeam.unknownModel", { role: roleId, model });
  }

  #job(jobId: string): RavenTeamJobRecord {
    const job = this.#store.findJob(jobId);
    if (!job) throw new Error(sourceText("error.agent.ravenTeam.jobNotFound"));
    return job;
  }

  /**
   * Makes the role's agent, or reuses the agent with the same role, model and effort. A new agent
   * starts on that model. The effort is set on the agent, which sends it with each turn, the same way
   * an agent chat does. An effort that is the model's default keeps the plain name, so the agents of
   * earlier jobs are reused.
   */
  #ensureRoleAgent(
    roleId: string,
    label: string,
    model: AgentModelId,
    provider: RavenTeamRoleRecord["provider"],
    fullAccess: boolean,
    reasoningEffort: AgentReasoningEffort | null,
  ) {
    return Effect.gen({ self: this }, function* () {
      const option = this.#agents.listModels().find((candidate) => candidate.id === model);
      const name = ravenRoleAgentName(label, model, reasoningEffort, option?.defaultReasoningEffort ?? null);
      const existing = this.#agents
        .listAgents()
        .find((agent) => agent.name === name && agent.provider === provider && agent.model === model);
      const effort = reasoningEffort === null ? {} : { reasoningEffort };
      const agent =
        existing ??
        (yield* this.#call(
          "create role agent",
          this.#agents.createAgent({
            name,
            description: `Raven Stack team role: ${label}.`,
            avatarSeed: `raven-${roleId}`,
            avatarHue: null,
            initialMessage: ROLE_AGENT_GREETING,
            provider,
            model,
            ...effort,
          }),
        ));
      yield* this.#call(
        "set role access",
        this.#agents.updateAgent({ agentId: agent.id, access: fullAccess ? "full" : "workspace", ...effort }),
      );
      return { id: agent.id, provider: agent.provider, model: agent.model };
    });
  }

  /** Changes the model of a role's agent, and records it. An unknown model is refused, never replaced. */
  #switchRoleModel(jobId: string, roleId: string, model: string) {
    return Effect.gen({ self: this }, function* () {
      const job = this.#job(jobId);
      const role = job.roles.find((candidate) => candidate.roleId === roleId);
      if (!role?.agentId) {
        return yield* new RavenTeamFailed({
          operation: "set role model",
          cause: new Error(sourceText("error.agent.ravenTeam.unknownRole", { role: roleId })),
        });
      }
      const option = this.#agents.listModels().find((candidate) => candidate.id === model);
      if (!option) {
        return yield* new RavenTeamFailed({
          operation: "set role model",
          cause: new Error(this.#unknownModelText(roleId, model)),
        });
      }
      yield* this.#call(
        "change role model",
        this.#agents.updateAgent({ agentId: role.agentId, provider: option.provider, model: option.id }),
      );
      this.#store.updateRole(jobId, roleId, { provider: option.provider, model: option.id }, this.#now());
    });
  }

  /**
   * Sends a message to a role. A role with no task starts its work thread with `text`; a role that
   * has one gets `text` as its next message. The text is redacted and kept as the pending message
   * until its turn starts.
   */
  #deliver(jobId: string, roleId: string, text: string) {
    return Effect.gen({ self: this }, function* () {
      const job = this.#job(jobId);
      const role = job.roles.find((candidate) => candidate.roleId === roleId);
      if (!role?.agentId) {
        return yield* new RavenTeamFailed({
          operation: "send to role",
          cause: new Error(sourceText("error.agent.ravenTeam.unknownRole", { role: roleId })),
        });
      }
      const safe = redactText(text);
      const now = this.#now();
      if (this.#cannotRunAccess(role)) {
        // The provider would refuse the turn, and the role would show Working forever. It asks instead.
        this.#askAccess(jobId, roleId, safe);
        return;
      }
      if (role.taskId === null) {
        const task = yield* this.#call(
          "start role task",
          this.#agents.startTask({ agentId: role.agentId, text: safe }),
        );
        this.#store.updateRole(
          jobId,
          roleId,
          { taskId: task.id, threadId: task.threadId, state: "working", pendingMessage: safe },
          now,
        );
      } else {
        yield* this.#call(
          "send to role",
          this.#agents.sendMessage({ agentId: role.agentId, taskId: role.taskId, text: safe, attachmentDraftIds: [] }),
        );
        this.#store.updateRole(jobId, roleId, { state: "working", pendingMessage: safe }, now);
      }
      this.#changed(jobId);
    });
  }

  /** The role's first message, or its next one. A role's first message carries its brief. */
  #engage(jobId: string, roleId: string, extra: string | null) {
    return Effect.gen({ self: this }, function* () {
      const job = this.#job(jobId);
      const role = job.roles.find((candidate) => candidate.roleId === roleId);
      if (!role) return;
      const text =
        role.taskId === null
          ? [
              roleBrief({
                jobId,
                roleId,
                label: role.label,
                skills: role.skills,
                access: role.access,
                ticket: job.brief,
              }),
              extra,
            ]
              .filter(Boolean)
              .join("\n\n")
          : (extra ?? resumeNotice());
      yield* this.#deliver(jobId, roleId, text);
    });
  }

  /** Runs an agent call and types its failure as a team failure. */
  #call<A>(operation: string, effect: Effect.Effect<A, unknown>): Effect.Effect<A, RavenTeamFailed> {
    return effect.pipe(Effect.mapError((cause) => new RavenTeamFailed({ operation, cause })));
  }

  /** Marks a role blocked and asks the user. The error is logged redacted; its text is not shown raw. */
  #blockRole(jobId: string, roleId: string, kind: RavenTeamQuestionKind, error: unknown) {
    return Effect.sync(() => {
      logger.warn("A Raven Stack role could not run.", { cause: redactText(String(error)) });
      this.#blockedAt(jobId, roleId, kind);
    });
  }

  #blockedAt(jobId: string, roleId: string, kind: RavenTeamQuestionKind): void {
    const now = this.#now();
    this.#store.updateRole(jobId, roleId, { state: "blocked" }, now);
    this.#store.updateJob(
      jobId,
      { state: "waiting-user", question: { kind, roleId } satisfies RavenTeamQuestion },
      now,
    );
    this.#changed(jobId);
  }

  /**
   * Adds a switch to the job's Autopilot decision, so the ticket shows why the model or stack changed. The
   * role agent stays the same agent with its thread: only its model changes. A job with no decision keeps none.
   */
  #recordSwitch(jobId: string, change: RavenAutopilotDecisionSwitch): void {
    const job = this.#job(jobId);
    const decision = job.decision;
    if (!decision) return;
    const switches = [...(decision.switches ?? []), change].slice(-RAVEN_AUTOPILOT_SWITCH_LIMIT);
    const roles = decision.roles.map((role) => (role.roleId === change.roleId ? { ...role, model: change.to } : role));
    this.#store.updateJob(jobId, { decision: { ...decision, roles, switches } }, this.#now());
  }

  #turnCompleted(jobId: string, roleId: string, status: string) {
    return Effect.gen({ self: this }, function* () {
      const job = this.#job(jobId);
      const role = job.roles.find((candidate) => candidate.roleId === roleId);
      if (role?.state !== "working" || !role.agentId || !role.taskId) return;
      const now = this.#now();
      if (status !== "completed") {
        if (isTerminal(job)) return;
        if (job.state === "stopped" || status === "interrupted") {
          this.#store.updateRole(jobId, roleId, { state: "stopped" }, now);
          this.#changed(jobId);
          return;
        }
        this.#blockedAt(jobId, roleId, "blocked");
        return;
      }
      const text = this.#lastReply(role.agentId, role.taskId);
      const report = parseRavenTeamReport(text);
      if (isTerminal(job)) {
        this.#store.updateRole(jobId, roleId, { state: "reported" }, now);
        this.#changed(jobId);
        return;
      }
      if (job.state === "stopped") {
        this.#store.updateRole(jobId, roleId, { state: "stopped" }, now);
        this.#changed(jobId);
        return;
      }
      if (!report) {
        yield* this.#askReport(jobId, roleId);
        return;
      }
      yield* this.#dispatch(jobId, roleId, report, text);
    });
  }

  /** The text of the role's last reply in its task. Empty when the task has none. */
  #lastReply(agentId: string, taskId: string): string {
    const reply = this.#agents
      .readTask(agentId, taskId)
      .messages.filter((message) => message.author === "assistant")
      .at(-1);
    return reply?.text ?? "";
  }

  /** The role's report is missing. It is asked once more; a second miss blocks the role. */
  #askReport(jobId: string, roleId: string) {
    return Effect.gen({ self: this }, function* () {
      const job = this.#job(jobId);
      const role = job.roles.find((candidate) => candidate.roleId === roleId);
      if (!role) return;
      if (role.reminders >= 1) {
        this.#blockedAt(jobId, roleId, "no-report");
        return;
      }
      this.#store.updateRole(jobId, roleId, { reminders: role.reminders + 1 }, this.#now());
      yield* this.#deliver(jobId, roleId, reportReminder(roleId));
    });
  }

  #dispatch(jobId: string, roleId: string, report: RavenTeamReport, text: string) {
    return Effect.gen({ self: this }, function* () {
      const job = this.#job(jobId);
      const role = job.roles.find((candidate) => candidate.roleId === roleId);
      if (!role) return;
      const now = this.#now();
      if (report.verdict === "BLOCKED") {
        this.#blockedAt(jobId, roleId, "blocked");
        return;
      }
      if (roleId === RAVEN_TEAM_BUILDER_ROLE_ID) {
        yield* this.#builderReported(jobId, report, text);
        return;
      }
      if (isVerifier(role)) {
        yield* this.#verifierReported(jobId, roleId, report, text);
        return;
      }
      // The Architect and the Editor, and any other role, report DONE with their text.
      this.#store.updateRole(jobId, roleId, { state: "reported", verdict: "DONE", reminders: 0 }, now);
      if (roleId === "architect") {
        const builder = job.roles.find((candidate) => candidate.roleId === RAVEN_TEAM_BUILDER_ROLE_ID);
        if (builder && builder.taskId === null) {
          yield* this.#engage(jobId, builder.roleId, planHandoff(role.label, text));
        }
      } else if (roleId === "editor") {
        const builder = job.roles.find((candidate) => candidate.roleId === RAVEN_TEAM_BUILDER_ROLE_ID);
        if (builder?.taskId) yield* this.#deliver(jobId, builder.roleId, editorNotesHandoff(text));
      }
      this.#changed(jobId);
    });
  }

  #builderReported(jobId: string, report: RavenTeamReport, text: string) {
    return Effect.gen({ self: this }, function* () {
      const now = this.#now();
      if (report.verdict !== "DONE" || report.commit === null) {
        yield* this.#askReport(jobId, RAVEN_TEAM_BUILDER_ROLE_ID);
        return;
      }
      const commit = report.commit;
      this.#store.updateRole(
        jobId,
        RAVEN_TEAM_BUILDER_ROLE_ID,
        { state: "reported", verdict: "DONE", commit, reminders: 0 },
        now,
      );
      const job = this.#job(jobId);
      if (job.headCommit === commit) {
        this.#changed(jobId);
        return;
      }
      // A new commit is a new head. Every verdict of the old head is stale, so the verifiers check this one.
      this.#store.updateJob(jobId, { headCommit: commit, state: "running", question: null }, now);
      // A job that leaves out every checking role has nothing to wait for: the Builder's commit ends it.
      if (!job.roles.some(isVerifier)) this.#store.updateJob(jobId, { state: "done" }, now);
      for (const role of job.roles) {
        if (role.roleId === RAVEN_TEAM_BUILDER_ROLE_ID || !(isVerifier(role) || role.roleId === "editor")) continue;
        this.#store.updateRole(jobId, role.roleId, { verdict: null, score: null, commit: null, state: "waiting" }, now);
        yield* this.#engage(jobId, role.roleId, commitHandoff(commit, text)).pipe(
          Effect.catch((error) => this.#blockRole(jobId, role.roleId, "blocked", error)),
        );
      }
      this.#changed(jobId);
    });
  }

  #verifierReported(jobId: string, roleId: string, report: RavenTeamReport, text: string) {
    return Effect.gen({ self: this }, function* () {
      const now = this.#now();
      const job = this.#job(jobId);
      const role = job.roles.find((candidate) => candidate.roleId === roleId);
      if (!role || job.headCommit === null) return;
      const isQuality = role.skills.includes("quality");
      const verdictOk = report.verdict === "PASS" || report.verdict === "PASS+NOTES" || report.verdict === "FAIL";
      if (!verdictOk || (isQuality && report.score === null)) {
        yield* this.#askReport(jobId, roleId);
        return;
      }
      const reported = report.commit ?? job.headCommit;
      if (reported !== job.headCommit) {
        // A verdict on an old commit counts for nothing. The role checks the head.
        this.#store.updateRole(jobId, roleId, { state: "working" }, now);
        yield* this.#deliver(jobId, roleId, staleCommitNotice(reported, job.headCommit)).pipe(
          Effect.catch((error) => this.#blockRole(jobId, roleId, "blocked", error)),
        );
        return;
      }
      const failed = report.verdict === "FAIL" || (isQuality && (report.score ?? 0) < 10);
      const verdict: RavenTeamVerdict = failed ? "FAIL" : report.verdict;
      this.#store.updateRole(
        jobId,
        roleId,
        {
          state: failed ? "failed" : "passed",
          verdict,
          score: report.score,
          commit: reported,
          fails: failed ? role.fails + 1 : role.fails,
          reminders: 0,
        },
        now,
      );
      if (failed) {
        yield* this.#failRound(jobId, roleId, text);
        return;
      }
      const after = this.#job(jobId);
      const verifiers = after.roles.filter(isVerifier);
      if (
        verifiers.length > 0 &&
        verifiers.every((candidate) => candidate.state === "passed" && candidate.commit === after.headCommit)
      ) {
        this.#store.updateJob(jobId, { state: "done" }, now);
      }
      this.#changed(jobId);
    });
  }

  /** One FAIL round: the findings go to the Builder. The second round asks for a stronger model; the cap stops the job. */
  #failRound(jobId: string, failedRoleId: string, text: string) {
    return Effect.gen({ self: this }, function* () {
      const now = this.#now();
      const job = this.#job(jobId);
      const failed = job.roles.find((candidate) => candidate.roleId === failedRoleId);
      const rounds = job.fixRounds + 1;
      this.#store.updateJob(jobId, { fixRounds: rounds }, now);
      const builder = job.roles.find((candidate) => candidate.roleId === RAVEN_TEAM_BUILDER_ROLE_ID);
      if (rounds >= job.roundCap || !builder || !failed) {
        this.#store.updateJob(jobId, { state: "not-done" }, now);
        this.#changed(jobId);
        return;
      }
      const findings = findingsHandoff(failed.label, job.headCommit, text);
      if (rounds === RAVEN_TEAM_ESCALATE_AFTER_FAILS) {
        if (job.fallbackModel) {
          yield* this.#switchRoleModel(jobId, builder.roleId, job.fallbackModel);
          this.#recordSwitch(jobId, {
            round: rounds,
            roleId: builder.roleId,
            kind: "model",
            from: builder.model,
            to: job.fallbackModel,
            at: now,
          });
          yield* this.#deliver(jobId, builder.roleId, findings);
          this.#changed(jobId);
          return;
        }
        // No stronger model was named: the Builder waits, and the user names one.
        this.#store.updateRole(jobId, builder.roleId, { state: "waiting", pendingMessage: redactText(findings) }, now);
        this.#store.updateJob(
          jobId,
          { state: "waiting-user", question: { kind: "fallback-model", roleId: builder.roleId } },
          now,
        );
        this.#changed(jobId);
        return;
      }
      yield* this.#deliver(jobId, builder.roleId, findings);
    });
  }
}

/** The decision with the roles and models that the job really starts with, after the plan checked them. */
function decisionWithModels(
  decision: RavenAutopilotDecision,
  roles: readonly RavenTeamRoleRecord[],
): RavenAutopilotDecision {
  return {
    ...decision,
    roles: roles.map((role) => ({ roleId: role.roleId, label: role.label, model: role.model })),
    switches: [...(decision.switches ?? [])],
  };
}
