import {
  type ActionRiskLevel,
  type AgentBudgetLimits,
  type AgentBudgets,
  type AgentUsageTotals,
  type BudgetLimitKind,
  exceededBudgetLimit,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import type { AutonomyAuditInput, AutonomyAuditStore } from "./autonomy-audit-store";
import { type AutonomyPolicy, levelAsks } from "./autonomy-policy";
import type { AutonomyUsageStore } from "./autonomy-usage-store";

const logger = createOpenBotLogger("autonomy");

/** How often the running turns are checked against their budgets. */
const BUDGET_TICK_MS = 2_000;

/** A turn that runs now. Its usage is read from the provider's records while it runs. */
export interface RunningTurn {
  agentId: string;
  threadId: string;
  /** The work thread of the turn, or null for the agent's own chat. */
  taskId: string | null;
  turnId: string;
  /** Epoch milliseconds. */
  startedAt: number;
}

interface EndedTurn extends RunningTurn {
  /** Epoch milliseconds. */
  endedAt: number;
}

/** The limit that a turn or a lane ran into, and the scope it counted in. */
interface BudgetHit {
  scope: "task" | "day";
  limit: BudgetLimitKind;
  used: number;
  allowed: number;
}

interface AutonomyControllerOptions {
  policy: AutonomyPolicy;
  audit: AutonomyAuditStore;
  usage: AutonomyUsageStore;
  /** The tokens and the estimated cost of a turn so far, from its provider usage records, or null. */
  readTurnUsage(agentId: string, turnId: string, startedAt: number): { tokens: number; costUsd: number | null } | null;
  /** Stops a turn that reached a limit. The turn ends, and its queue waits behind the budget hold. */
  stopTurn(turn: RunningTurn): void;
  now?: () => number;
}

const ZERO_TOTALS: AgentUsageTotals = { tokens: 0, minutes: 0, costUsd: null };

function hasLimit(limits: AgentBudgetLimits): boolean {
  return limits.tokens !== null || limits.minutes !== null || limits.costUsd !== null;
}

function addCost(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function addTotals(a: AgentUsageTotals, b: AgentUsageTotals): AgentUsageTotals {
  return { tokens: a.tokens + b.tokens, minutes: a.minutes + b.minutes, costUsd: addCost(a.costUsd, b.costUsd) };
}

function amountOf(totals: AgentUsageTotals, kind: BudgetLimitKind): number {
  if (kind === "tokens") return totals.tokens;
  if (kind === "minutes") return totals.minutes;
  return totals.costUsd ?? 0;
}

function startOfLocalDay(now: number): string {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
}

/**
 * Applies the person's graded permissions and budgets to the agent service's decisions.
 *
 * It answers three questions. Does a rule let this approval run without asking? Is this lane held by
 * Stop all agents or by a budget? Does a running turn reach a budget, so it must stop? It also writes
 * the turn usage, one row per finished turn. It never writes provider or conversation state: the
 * caller acts on each answer.
 *
 * A budget counts the finished turns and the turns that run now. A turn that runs is checked every
 * `BUDGET_TICK_MS`, so a limit can be passed by the usage of the turn in progress, up to one check.
 */
export class AutonomyController {
  readonly #policy: AutonomyPolicy;
  readonly #audit: AutonomyAuditStore;
  readonly #usage: AutonomyUsageStore;
  readonly #readTurnUsage: AutonomyControllerOptions["readTurnUsage"];
  readonly #stopTurn: AutonomyControllerOptions["stopTurn"];

  readonly #now: () => number;
  readonly #running = new Map<string, RunningTurn>();
  readonly #stopping = new Set<string>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AutonomyControllerOptions) {
    this.#policy = options.policy;
    this.#audit = options.audit;
    this.#usage = options.usage;
    this.#readTurnUsage = options.readTurnUsage;
    this.#stopTurn = options.stopTurn;
    this.#now = options.now ?? Date.now;
  }

  /** Whether the person's rule lets an action at this level run without a card. Low risk always does. */
  answersWithoutAsking(agentId: string, level: ActionRiskLevel): boolean {
    return !levelAsks(this.#policy.approvalRules(agentId), level);
  }

  /** Why a lane may not start a turn now, or null. Read at each drain. */
  holdFor(agentId: string, taskId: string | null): "stopped" | "budget" | null {
    if (this.#policy.stoppedAll()) return "stopped";
    return this.#hit(agentId, taskId) === null ? null : "budget";
  }

  /** Stop all agents is on. Read by the agent service to tell the person what it did. */
  stoppedAll(): boolean {
    return this.#policy.stoppedAll();
  }

  /** Writes an audit row. A failed write is logged and never stops the action it describes. */
  record(input: AutonomyAuditInput): void {
    try {
      this.#audit.record(input);
    } catch (error) {
      logger.error("An audit entry could not be written.", { action: input.action, error });
    }
  }

  turnStarted(turn: RunningTurn): void {
    this.#running.set(turn.turnId, turn);
    if (this.#timer === null) {
      this.#timer = setInterval(() => this.#tick(), BUDGET_TICK_MS);
      this.#timer.unref?.();
    }
  }

  turnEnded(turn: EndedTurn): void {
    this.#running.delete(turn.turnId);
    this.#stopping.delete(turn.turnId);
    if (this.#running.size === 0) this.#stopTimer();
    try {
      const usage = this.#readTurnUsage(turn.agentId, turn.turnId, turn.startedAt);
      this.#usage.record({
        turnId: turn.turnId,
        agentId: turn.agentId,
        threadId: turn.threadId,
        taskId: turn.taskId,
        startedAt: new Date(turn.startedAt).toISOString(),
        endedAt: new Date(turn.endedAt).toISOString(),
        durationMs: Math.max(0, turn.endedAt - turn.startedAt),
        tokens: usage?.tokens ?? 0,
        costUsd: usage?.costUsd ?? null,
      });
    } catch (error) {
      logger.error("A turn could not be recorded for its budget.", { turnId: turn.turnId, error });
    }
  }

  /** Stops the timer. The agent service calls it when it shuts down. */
  dispose(): void {
    this.#stopTimer();
  }

  #stopTimer(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  #tick(): void {
    for (const turn of [...this.#running.values()]) {
      if (this.#stopping.has(turn.turnId)) continue;
      const hit = this.#hit(turn.agentId, turn.taskId);
      if (hit === null) continue;
      this.#stopping.add(turn.turnId);
      this.record({
        action: "budget.stopped",
        agentId: turn.agentId,
        threadId: turn.threadId,
        taskId: turn.taskId,
        risk: null,
        result: "stopped",
        target: `${hit.scope}:${hit.limit}`,
        detail: `${hit.used} of ${hit.allowed}`,
      });
      try {
        this.#stopTurn(turn);
      } catch (error) {
        logger.error("A turn could not be stopped at its budget.", { turnId: turn.turnId, error });
      }
    }
  }

  /**
   * The first limit that the task or the agent's day has reached, counting the finished turns and
   * the turns that run now. A task limit is checked first. Null when no limit is reached.
   */
  #hit(agentId: string, taskId: string | null): BudgetHit | null {
    const budgets: AgentBudgets = this.#policy.budgets(agentId);
    if (!hasLimit(budgets.perTask) && !hasLimit(budgets.perDay)) return null;
    const now = this.#now();
    const running = [...this.#running.values()].filter((turn) => turn.agentId === agentId);

    if (taskId !== null && hasLimit(budgets.perTask)) {
      const runningOfTask = running.filter((turn) => turn.taskId === taskId);
      const used = addTotals(this.#usage.totals({ agentId, taskId }), this.#inFlight(runningOfTask, now));
      const limit = exceededBudgetLimit(budgets.perTask, used);
      if (limit !== null)
        return { scope: "task", limit, used: amountOf(used, limit), allowed: budgets.perTask[limit] ?? 0 };
    }

    if (hasLimit(budgets.perDay)) {
      const used = addTotals(
        this.#usage.totals({ agentId, since: startOfLocalDay(now) }),
        this.#inFlight(running, now),
      );
      const limit = exceededBudgetLimit(budgets.perDay, used);
      if (limit !== null)
        return { scope: "day", limit, used: amountOf(used, limit), allowed: budgets.perDay[limit] ?? 0 };
    }
    return null;
  }

  #inFlight(turns: RunningTurn[], now: number): AgentUsageTotals {
    let total = ZERO_TOTALS;
    for (const turn of turns) {
      const usage = this.#readTurnUsage(turn.agentId, turn.turnId, turn.startedAt);
      total = addTotals(total, {
        tokens: usage?.tokens ?? 0,
        minutes: Math.max(0, now - turn.startedAt) / 60_000,
        costUsd: usage?.costUsd ?? null,
      });
    }
    return total;
  }
}
