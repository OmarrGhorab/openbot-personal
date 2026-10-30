import {
  type AgentModelOption,
  type AgentProviderId,
  type AgentTasksSnapshot,
  type BoardTicket,
  RAVEN_AUTOPILOT_ROUND_CAP,
  RAVEN_AUTOPILOT_TICKETS_AT_ONCE,
  RAVEN_TEAM_BRIEF_LIMIT,
  type RavenAutopilotReasonCode,
  type RavenAutopilotSettings,
  type RavenAutopilotMerge,
  type RavenAutopilotMergeBlock,
  type RavenTeamJob,
  type RavenTicketMerged,
  parseRavenPullRequestUrl,
  ravenAutopilotMayMerge,
  ravenAutopilotPlaybooks,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import type { BoardTicketService } from "../board-tickets/board-ticket-service";
import { decideAutopilot } from "./autopilot-decision";
import { autopilotMergeVerdicts } from "./autopilot-merge";
import type { PullRequestMerger } from "./github-pull-request-merger";
import type { RavenTeamFailed, RavenTeamService } from "./raven-team-service";

const logger = createOpenBotLogger("autopilot");

/** The agent reads the engine needs: the models for the decision and the agents for the pick-up rule. */
export interface AutopilotAgents {
  listModels(): AgentModelOption[];
  preferredProvider(): AgentProviderId;
  listAgents(): readonly { id: string; name: string }[];
}

/**
 * The skill reads the engine needs. `pstackReady` answers whether the skill of a pstack playbook
 * (`pstack-<playbook>`) is installed; a failed read counts as not installed.
 */
export interface AutopilotSkills {
  pstackReady(playbook: string): Effect.Effect<boolean>;
}

/** The team operations the engine uses. */
export type AutopilotTeam = Pick<RavenTeamService, "start" | "listJobs" | "startQueuedJobs" | "job" | "recordMerge">;

/** How often a merge that waits for CI checks again, and for how long in all (#198). */
const MERGE_RETRY_MS = 60_000;
const MERGE_RETRY_LIMIT = 30;

const MERGE_BLOCK_KEYS = {
  "new-commit": "error.agent.autopilot.mergeBlocked.newCommit",
  "ci-failing": "error.agent.autopilot.mergeBlocked.ciFailing",
  "ci-missing": "error.agent.autopilot.mergeBlocked.ciMissing",
  "ci-timeout": "error.agent.autopilot.mergeBlocked.ciTimeout",
  "no-pull-request": "error.agent.autopilot.mergeBlocked.noPullRequest",
  "pull-request-closed": "error.agent.autopilot.mergeBlocked.pullRequestClosed",
  "not-connected": "error.agent.autopilot.mergeBlocked.notConnected",
  refused: "error.agent.autopilot.mergeBlocked.refused",
} as const satisfies Record<RavenAutopilotMergeBlock, string>;

export interface AutopilotEngineOptions {
  board: BoardTicketService;
  team: AutopilotTeam;
  agents: AutopilotAgents;
  /**
   * The GitHub side of the Reviewer's merge (#198). Absent: GitHub cannot be reached from here, and a job
   * that may merge gets the `not-connected` note instead.
   */
  merger?: PullRequestMerger;
  /** Absent: no pstack playbook counts as installed, so a pstack choice runs Autopilot lite and says why. */
  skills?: AutopilotSkills;
  /** Read at each pick-up, so a change of the settings applies to the next ticket at once. */
  settings: () => RavenAutopilotSettings;
  /** The repository or project of the board's sync target, such as `owner/repo`. Null without sync. */
  repo: () => string | null;
  /** Called after the engine's state changes (a pick-up, a pause), so the Autopilot tab reads it again. */
  changed?: () => void;
  now?: () => string;
}

/** What the Autopilot tab shows: the live counts and why Autopilot does not take a ticket now. */
export interface AutopilotEngineStatus {
  enabled: boolean;
  /** Autopilot jobs that run now, a queued one included. */
  running: number;
  /** Backlog tickets that Autopilot can take when a slot frees. */
  waiting: number;
  slots: number;
  /** Set while a usage limit holds a role of an Autopilot job and the settings pause on it. */
  paused: "usage-limit" | null;
}

/** The role agents of a Raven team are named "Raven <role> (<model>)". */
const RAVEN_AGENT_NAME = /^Raven\b/u;

const REASON_KEYS = {
  "feature-large": "error.agent.autopilot.reason.featureLarge",
  "feature-small": "error.agent.autopilot.reason.featureSmall",
  "bug-failing-case": "error.agent.autopilot.reason.bugFailingCase",
  "bug-investigate": "error.agent.autopilot.reason.bugInvestigate",
  "chore-small": "error.agent.autopilot.reason.choreSmall",
  override: "error.agent.autopilot.reason.override",
  "manual-stack": "error.agent.autopilot.reason.manualStack",
  "pstack-missing": "error.agent.autopilot.reason.pstackMissing",
} as const satisfies Record<RavenAutopilotReasonCode, string>;

function isAutopilotJob(job: RavenTeamJob): boolean {
  return job.decision !== undefined && job.decision !== null;
}

function clampCount(value: number, range: { min: number; max: number; default: number }): number {
  return Number.isInteger(value) && value >= range.min && value <= range.max ? value : range.default;
}

/**
 * Autopilot: Raven takes the next Backlog ticket when a slot is free, decides the stack, the team and a
 * model for each role, and starts a team job that works until the ticket is done or a limit stops it.
 *
 * - At most `ticketsAtOnce` Autopilot jobs run at once (default 2). A third ticket waits in Backlog.
 * - The decision and its reason are stored on the job, so the board and the chat card show them, and a
 *   later change of the settings does not change a running job.
 * - A ticket whose type is not set and cannot be detected stays in Backlog with a note. It is taken when
 *   the person sets the type or changes the ticket.
 * - When a job stops at the round limit, or a role needs the person, the ticket gets a note that says so.
 * - A usage limit on a role of an Autopilot job pauses new pick-ups until the provider allows work again.
 *
 * The engine keeps no state that matters across a restart: the jobs, their agents and threads are in the
 * database, and a pick-up reads the board and the jobs again. Only the notes it wrote and the usage-limit
 * holds are in memory, and both are read again from the board and the task events.
 */
export class AutopilotEngine {
  readonly #board: BoardTicketService;
  readonly #team: AutopilotTeam;
  readonly #agents: AutopilotAgents;
  readonly #skills: AutopilotSkills | null;
  readonly #merger: PullRequestMerger | null;
  /** Jobs whose merge runs now, so two job changes never merge one job twice. */
  readonly #merging = new Set<string>();
  /** How many times each job's merge waited for CI, and the timers of those waits. */
  readonly #mergeWaits = new Map<string, number>();
  readonly #mergeTimers = new Set<ReturnType<typeof setTimeout>>();
  readonly #settings: () => RavenAutopilotSettings;
  readonly #repo: () => string | null;
  readonly #changed: () => void;
  readonly #now: () => string;
  readonly #lock = Semaphore.makeUnsafe(1);
  /** Tickets that got a note and stay in Backlog until they change: ticket id to its `updatedAt` then. */
  readonly #held = new Map<string, string>();
  /** The last state of each Autopilot job that the engine told the person about. */
  readonly #told = new Map<string, string>();
  /** The agents whose tasks a usage limit holds now. */
  readonly #usageHeld = new Set<string>();
  #scheduled = false;
  #stopped = false;

  constructor(options: AutopilotEngineOptions) {
    this.#board = options.board;
    this.#team = options.team;
    this.#agents = options.agents;
    this.#skills = options.skills ?? null;
    this.#merger = options.merger ?? null;
    this.#settings = options.settings;
    this.#repo = options.repo;
    this.#changed = options.changed ?? (() => {});
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * The start of the app: the state of each job is read as already told, the queued team jobs get their
   * chance to start, and the first pick-up runs. A job keeps its agents and threads from before.
   */
  start(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      for (const job of this.#team.listJobs()) if (isAutopilotJob(job)) this.#told.set(job.id, job.state);
      // A job that passed while the app was closed, or before a merge ended, is read again for the merge.
      for (const job of this.#team.listJobs()) this.#considerMerge(job);
      yield* this.#team.startQueuedJobs();
      yield* this.tick();
    });
  }

  /** Stops new pick-ups. A job that runs goes on; it is the team's, not the engine's. */
  stop(): void {
    this.#stopped = true;
    for (const timer of this.#mergeTimers) clearTimeout(timer);
    this.#mergeTimers.clear();
  }

  /** Asks for a pick-up soon. Several calls in one turn of the event loop run one pick-up. */
  wake(): void {
    if (this.#scheduled || this.#stopped) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      Effect.runFork(this.tick());
    });
  }

  status(): AutopilotEngineStatus {
    const settings = this.#settings();
    return {
      enabled: settings.enabled,
      running: this.#activeJobs().length,
      waiting: this.#candidates(settings).length,
      slots: clampCount(settings.ticketsAtOnce, RAVEN_AUTOPILOT_TICKETS_AT_ONCE),
      paused: this.#paused(settings) ? "usage-limit" : null,
    };
  }

  /**
   * A team job changed. An Autopilot job that ended, or that waits for the person, gets a note on its
   * ticket once per state, and its slot may be free now.
   */
  noticeJob(job: RavenTeamJob): void {
    if (!isAutopilotJob(job)) return;
    const before = this.#told.get(job.id);
    this.#told.set(job.id, job.state);
    if (before !== undefined && before !== job.state) this.#tell(job);
    this.#considerMerge(job);
    this.wake();
  }

  /** The work threads of an agent changed. A usage limit on a role of an Autopilot job pauses pick-ups. */
  noticeTasks(snapshot: AgentTasksSnapshot): void {
    const autopilotTasks = new Set(
      this.#activeJobs().flatMap((job) => job.roles.flatMap((role) => (role.taskId ? [role.taskId] : []))),
    );
    const held = snapshot.tasks.some((task) => task.hold === "usage-limit" && autopilotTasks.has(task.id));
    if (held === this.#usageHeld.has(snapshot.agentId)) return;
    if (held) this.#usageHeld.add(snapshot.agentId);
    else this.#usageHeld.delete(snapshot.agentId);
    if (held && this.#settings().pauseOnUsageLimit) {
      for (const job of this.#activeJobs()) {
        if (!job.roles.some((role) => role.agentId === snapshot.agentId)) continue;
        this.#note(job.decision?.ticketId ?? null, sourceText("error.agent.autopilot.usageLimit"));
      }
    }
    this.#changed();
    this.wake();
  }

  /** One pick-up: while a slot is free, the next Backlog ticket starts a job. Locked, so two never overlap. */
  tick(): Effect.Effect<void> {
    return this.#lock
      .withPermit(
        Effect.gen({ self: this }, function* () {
          if (this.#stopped) return;
          const settings = this.#settings();
          if (!settings.enabled || this.#paused(settings)) return;
          let free = clampCount(settings.ticketsAtOnce, RAVEN_AUTOPILOT_TICKETS_AT_ONCE) - this.#activeJobs().length;
          for (const ticket of this.#candidates(settings)) {
            if (free <= 0) break;
            if (yield* this.#take(ticket, settings)) free -= 1;
          }
        }),
      )
      .pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => logger.warn("An Autopilot pick-up failed.", { cause: redactText(String(cause)) })),
        ),
      );
  }

  // ---- internals ----

  #paused(settings: RavenAutopilotSettings): boolean {
    return settings.pauseOnUsageLimit && this.#usageHeld.size > 0;
  }

  /** Autopilot jobs that hold a slot: running, queued for a role agent included. One that waits for the person holds none. */
  #activeJobs(): RavenTeamJob[] {
    return this.#team.listJobs().filter((job) => isAutopilotJob(job) && job.state === "running");
  }

  /** Backlog tickets Autopilot may take, in board order. A ticket with a thread or a team job is someone's already. */
  #candidates(settings: RavenAutopilotSettings): BoardTicket[] {
    const ravenAgents = new Set(
      this.#agents
        .listAgents()
        .filter((agent) => RAVEN_AGENT_NAME.test(agent.name))
        .map((agent) => agent.id),
    );
    const assigneeAllowed = (agentId: string | null) =>
      agentId === null ? settings.pickUp.assignee === "raven-or-unassigned" : ravenAgents.has(agentId);
    return this.#board
      .list()
      .filter(
        (ticket) =>
          ticket.status === settings.pickUp.column &&
          ticket.teamJobId === null &&
          ticket.teamRoleId === null &&
          ticket.taskId === null &&
          assigneeAllowed(ticket.agentId) &&
          this.#held.get(ticket.id) !== ticket.updatedAt,
      )
      .sort((left, right) => left.order - right.order);
  }

  /** Decides and starts one ticket. Answers whether a job started. */
  #take(ticket: BoardTicket, settings: RavenAutopilotSettings): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const ready = yield* this.#installedPlaybooks();
      const choice = decideAutopilot({
        ticket: { id: ticket.id, title: ticket.title, body: ticket.body, type: ticket.type, repo: this.#repo() },
        settings,
        models: this.#agents.listModels(),
        preferredProvider: this.#agents.preferredProvider(),
        pstackReady: (playbook) => ready.has(playbook),
        reasonText: (code, files, type) =>
          code === "feature-large" && files !== null
            ? sourceText("error.agent.autopilot.reason.featureFiles", { count: files })
            : sourceText(REASON_KEYS[code], { type }),
        now: this.#now(),
      });
      if (!choice) {
        this.#hold(ticket.id, sourceText("error.agent.autopilot.noType"));
        return false;
      }
      const roundCap = clampCount(settings.roundCap, RAVEN_AUTOPILOT_ROUND_CAP);
      const started = yield* this.#team
        .start(
          {
            templateId: choice.decision.templateId ?? ticket.id,
            brief: ticketBrief(ticket, choice.decision.repo ?? null),
            models: choice.models,
          },
          { decision: choice.decision, roundCap },
        )
        .pipe(
          Effect.catch((error: RavenTeamFailed) => {
            const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
            this.#hold(ticket.id, sourceText("error.agent.autopilot.startFailed", { reason: redactText(cause) }));
            return Effect.succeed(null);
          }),
        );
      if (!started) return false;
      // A pstack playbook that is not installed is never silent: the ticket says what ran instead and how to fix it.
      if (choice.missingSkill !== null) {
        this.#note(ticket.id, sourceText("error.agent.autopilot.pstackMissing", { skill: choice.missingSkill }));
      }
      this.#told.set(started.id, started.state);
      this.#changed();
      return true;
    });
  }

  /**
   * Starts the Reviewer's merge of a job that passed (#198), when the settings allow it for the ticket type
   * and the team rules hold. Nothing happens, and the ticket waits in Needs review, while the setting or
   * the type's switch is off.
   */
  #considerMerge(job: RavenTeamJob): void {
    const decision = job.decision;
    if (this.#stopped || !decision || decision.merge || this.#merging.has(job.id)) return;
    if (!ravenAutopilotMayMerge(this.#settings(), decision.ticketType) || !autopilotMergeVerdicts(job)) return;
    this.#merging.add(job.id);
    Effect.runFork(
      this.#merge(job.id).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => logger.warn("An Autopilot merge failed.", { cause: redactText(String(cause)) })),
        ),
        Effect.ensuring(Effect.sync(() => this.#merging.delete(job.id))),
      ),
    );
  }

  /**
   * One merge attempt. It merges only when every rule holds: the Reviewer's PASS and Quality's 10 on the head
   * commit, the pull request still at that commit, and every CI check green. The settings and the job are
   * read again just before the merge, so turning the setting off, or a new commit, stops it at once; GitHub
   * also refuses a merge whose head is not the commit that passed.
   */
  #merge(jobId: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const job = this.#team.job(jobId);
      const decision = job?.decision;
      if (!job || !decision || decision.merge) return;
      const settings = this.#settings();
      const verdicts = autopilotMergeVerdicts(job);
      if (!ravenAutopilotMayMerge(settings, decision.ticketType) || !verdicts) return;
      const prUrl = decision.pullRequest ?? null;
      const pr = prUrl ? parseRavenPullRequestUrl(prUrl) : null;
      const base = {
        method: settings.reviewerMerge.method,
        commit: verdicts.commit,
        prUrl: pr ? prUrl : null,
        prNumber: pr?.number ?? null,
      };
      const block = (reason: RavenAutopilotMergeBlock) => this.#blockMerge(job, reason, base);
      if (!pr) return yield* block("no-pull-request");
      if (!this.#merger) return yield* block("not-connected");
      const read = yield* Effect.result(this.#merger.read(pr));
      if (Result.isFailure(read)) return yield* block(read.failure.code === "not-connected" ? "not-connected" : "refused");
      const state = read.success;
      if (state.state !== "open") return yield* block("pull-request-closed");
      if (state.headSha !== verdicts.commit) return yield* block("new-commit");
      if (state.checks === "failing") return yield* block("ci-failing");
      if (state.checks === "none") return yield* block("ci-missing");
      if (state.checks === "pending") {
        const waits = (this.#mergeWaits.get(jobId) ?? 0) + 1;
        if (waits > MERGE_RETRY_LIMIT) return yield* block("ci-timeout");
        this.#mergeWaits.set(jobId, waits);
        this.#retryMerge(jobId);
        return;
      }
      // The last check before the write: the setting can be off now, and the job can have a new head.
      const now = this.#team.job(jobId);
      if (
        !now?.decision ||
        now.decision.merge ||
        now.headCommit !== verdicts.commit ||
        !autopilotMergeVerdicts(now) ||
        !ravenAutopilotMayMerge(this.#settings(), now.decision.ticketType)
      ) {
        return;
      }
      const merged = yield* Effect.result(this.#merger.merge(pr, { sha: verdicts.commit, method: base.method }));
      if (Result.isFailure(merged)) {
        const code = merged.failure.code;
        return yield* block(code === "head-moved" ? "new-commit" : code === "not-connected" ? "not-connected" : "refused");
      }
      this.#mergeWaits.delete(jobId);
      const mergedAt = this.#now();
      const ticket = decision.ticketId ? this.#board.get(decision.ticketId) : null;
      const event: RavenTicketMerged = {
        jobId,
        ticketId: decision.ticketId,
        ticketTitle: redactText(ticket?.title ?? decision.ticketTitle),
        ticketKey: ticket?.external?.key ?? null,
        repo: `${pr.owner}/${pr.repo}`,
        prNumber: pr.number,
        prUrl,
        commit: verdicts.commit,
        method: base.method,
        reviewer: verdicts.reviewer,
        qualityScore: verdicts.qualityScore,
        ci: "green",
        mergedAt,
      };
      yield* this.#team.recordMerge(jobId, { state: "merged", reason: null, ...base, at: mergedAt }, event);
      this.#note(
        decision.ticketId,
        sourceText("error.agent.autopilot.merged", { method: base.method, number: pr.number }),
      );
      this.#changed();
    });
  }

  /** Records why the Reviewer did not merge, and says so on the ticket. The ticket stays in Needs review. */
  #blockMerge(
    job: RavenTeamJob,
    reason: RavenAutopilotMergeBlock,
    base: Pick<RavenAutopilotMerge, "method" | "commit" | "prUrl" | "prNumber">,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.#mergeWaits.delete(job.id);
      yield* this.#team.recordMerge(job.id, { state: "blocked", reason, ...base, at: this.#now() }, null);
      this.#note(job.decision?.ticketId ?? null, sourceText(MERGE_BLOCK_KEYS[reason]));
      this.#changed();
    });
  }

  /** Reads the job again for its merge after a wait, while CI runs. */
  #retryMerge(jobId: string): void {
    if (this.#stopped) return;
    const timer = setTimeout(() => {
      this.#mergeTimers.delete(timer);
      const job = this.#team.job(jobId);
      if (job) this.#considerMerge(job);
    }, MERGE_RETRY_MS);
    this.#mergeTimers.add(timer);
  }

  /** The pstack playbooks whose skill is installed now. Read at each pick-up, so an install counts at once. */
  #installedPlaybooks(): Effect.Effect<Set<string>> {
    const skills = this.#skills;
    if (!skills) return Effect.succeed(new Set());
    return Effect.gen(function* () {
      const ready = new Set<string>();
      for (const playbook of ravenAutopilotPlaybooks()) {
        const installed = yield* skills.pstackReady(playbook).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              logger.warn("Could not read the pstack skills.", { cause: redactText(String(cause)) });
              return false;
            }),
          ),
        );
        if (installed) ready.add(playbook);
      }
      return ready;
    });
  }

  /** Leaves the ticket in Backlog with a note. It is not taken again until it changes. */
  #hold(ticketId: string, text: string): void {
    this.#note(ticketId, text);
    const ticket = this.#board.get(ticketId);
    if (ticket) this.#held.set(ticketId, ticket.updatedAt);
  }

  /** A note on the ticket's activity, once: the same last note is not written twice, also after a restart. */
  #note(ticketId: string | null, text: string): void {
    if (!ticketId) return;
    try {
      const last = this.#board
        .events(ticketId)
        .filter((event) => event.kind === "comment")
        .at(-1);
      if (last?.text === text) return;
      this.#board.comment({ ticketId, text }, "agent");
    } catch (error) {
      logger.warn("Could not write an Autopilot note.", { cause: redactText(String(error)) });
    }
  }

  /** Tells the person why an Autopilot job stopped, on its ticket. */
  #tell(job: RavenTeamJob): void {
    const ticketId = job.decision?.ticketId ?? null;
    switch (job.state) {
      case "not-done":
        this.#note(ticketId, sourceText("error.agent.autopilot.roundLimit", { rounds: job.roundCap }));
        return;
      case "waiting-user":
        this.#note(ticketId, sourceText("error.agent.autopilot.needsYou"));
        return;
      case "done":
        this.#note(ticketId, sourceText("error.agent.autopilot.passed"));
        return;
      default:
        return;
    }
  }
}

/** The ticket text a team job starts with: the title, the text, the link of its issue and the repository. */
function ticketBrief(ticket: BoardTicket, repo: string | null): string {
  return [ticket.title, ticket.body, ticket.external?.url, repo ? `Repository: ${repo}` : null]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join("\n\n")
    .slice(0, RAVEN_TEAM_BRIEF_LIMIT);
}
