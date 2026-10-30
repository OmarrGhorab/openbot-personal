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
  type RavenTeamJob,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import type { BoardTicketService } from "../board-tickets/board-ticket-service";
import { decideAutopilot } from "./autopilot-decision";
import type { RavenTeamFailed, RavenTeamService } from "./raven-team-service";

const logger = createOpenBotLogger("autopilot");

/** The agent reads the engine needs: the models for the decision and the agents for the pick-up rule. */
export interface AutopilotAgents {
  listModels(): AgentModelOption[];
  preferredProvider(): AgentProviderId;
  listAgents(): readonly { id: string; name: string }[];
}

/** The team operations the engine uses. */
export type AutopilotTeam = Pick<RavenTeamService, "start" | "listJobs" | "startQueuedJobs">;

export interface AutopilotEngineOptions {
  board: BoardTicketService;
  team: AutopilotTeam;
  agents: AutopilotAgents;
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
      yield* this.#team.startQueuedJobs();
      yield* this.tick();
    });
  }

  /** Stops new pick-ups. A job that runs goes on; it is the team's, not the engine's. */
  stop(): void {
    this.#stopped = true;
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
      const choice = decideAutopilot({
        ticket: { id: ticket.id, title: ticket.title, body: ticket.body, type: ticket.type, repo: this.#repo() },
        settings,
        models: this.#agents.listModels(),
        preferredProvider: this.#agents.preferredProvider(),
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
      this.#told.set(started.id, started.state);
      this.#changed();
      return true;
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
