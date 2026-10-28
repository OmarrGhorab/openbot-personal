import {
  type AgentUsageTotals,
  type AutonomyAgentSettings,
  type AutonomyAuditFilter,
  type AutonomyAuditPage,
  type AutonomySnapshot,
  type AutonomyTaskUsage,
  exceededBudgetLimit,
  type SetAgentApprovalRulesInput,
  type SetAgentBudgetsInput,
} from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import type { AgentService } from "../backend/agent-service";
import type { AutonomyAuditStore } from "../backend/autonomy/autonomy-audit-store";
import type { AutonomyUsageStore } from "../backend/autonomy/autonomy-usage-store";
import type { AutonomyPreferences } from "./autonomy-preferences";

/** A change of the autonomy settings, or Stop all agents, could not be saved or run. */
class AutonomyFailure extends Schema.TaggedError<AutonomyFailure>()("AutonomyFailure", {
  cause: Schema.Defect(),
}) {}

const toAutonomyFailure = (cause: unknown) => new AutonomyFailure({ cause });

/** Tasks listed per agent. The newest tasks come first, so the list stays short. */
const MAX_TASKS_PER_AGENT = 50;

export interface AutonomyAdminDependencies {
  preferences: AutonomyPreferences;
  service: Pick<AgentService, "listAgents" | "listTasks" | "stopAll" | "resumeAll">;
  audit: AutonomyAuditStore;
  usage: AutonomyUsageStore;
  now?: () => number;
}

export interface AutonomyAdmin {
  snapshot(): Effect.Effect<AutonomySnapshot, AutonomyFailure>;
  setApprovalRules(input: SetAgentApprovalRulesInput): Effect.Effect<AutonomySnapshot, AutonomyFailure>;
  setBudgets(input: SetAgentBudgetsInput): Effect.Effect<AutonomySnapshot, AutonomyFailure>;
  stopAll(): Effect.Effect<AutonomySnapshot, AutonomyFailure>;
  resumeAll(): Effect.Effect<AutonomySnapshot, AutonomyFailure>;
  listAuditLog(filter: AutonomyAuditFilter): Effect.Effect<AutonomyAuditPage, AutonomyFailure>;
}

const ZERO_TOTALS: AgentUsageTotals = { tokens: 0, minutes: 0, costUsd: null };

function startOfLocalDay(now: number): string {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
}

/**
 * The autonomy settings and usage of this computer's agents, and their writers. Each change of a rule
 * or a budget is written to the audit log with the values it changed to, so an undo can read them.
 * Stop all agents stores the stop before the agent service holds the lanes, so the stop holds
 * after a restart.
 */
export function createAutonomyAdmin({
  preferences,
  service,
  audit,
  usage,
  now = Date.now,
}: AutonomyAdminDependencies): AutonomyAdmin {
  function build(): AutonomySnapshot {
    const dayStart = startOfLocalDay(now());
    const agents: AutonomyAgentSettings[] = service.listAgents().map((agent) => {
      const budgets = preferences.budgets(agent.id);
      const taskTotals = usage.taskTotals(agent.id);
      const tasks: AutonomyTaskUsage[] = service
        .listTasks(agent.id)
        .tasks.slice(0, MAX_TASKS_PER_AGENT)
        .map((task) => {
          const totals = taskTotals.get(task.id) ?? ZERO_TOTALS;
          return {
            taskId: task.id,
            title: task.title,
            totals,
            exceeded: exceededBudgetLimit(budgets.perTask, totals),
          };
        });
      return {
        agentId: agent.id,
        agentName: agent.name,
        approvals: preferences.approvalRules(agent.id),
        budgets,
        today: usage.totals({ agentId: agent.id, since: dayStart }),
        tasks,
      };
    });
    return { stoppedAll: preferences.stoppedAll(), agents };
  }

  /** Writes an audit row for a change the person made. A failed write is not a failed change. */
  function recordChange(action: "rules.changed" | "budgets.changed", agentId: string, detail: string): void {
    try {
      audit.record({ action, agentId, risk: null, result: "saved", target: agentId ?? "all agents", detail });
    } catch {
      // The setting is saved either way; the log keeps the rest.
    }
  }

  const snapshot = Effect.sync(build);

  return {
    snapshot: () => snapshot.pipe(Effect.mapError(toAutonomyFailure)),
    setApprovalRules: (input) =>
      preferences.setApprovalRules(input).pipe(
        Effect.mapError(toAutonomyFailure),
        Effect.tap(() =>
          Effect.sync(() =>
            recordChange(
              "rules.changed",
              input.agentId,
              `medium=${input.approvals.medium ? "ask" : "allow"} high=${input.approvals.high ? "ask" : "allow"}`,
            ),
          ),
        ),
        Effect.andThen(snapshot.pipe(Effect.mapError(toAutonomyFailure))),
      ),
    setBudgets: (input) =>
      preferences.setBudgets(input).pipe(
        Effect.mapError(toAutonomyFailure),
        Effect.tap(() =>
          Effect.sync(() => recordChange("budgets.changed", input.agentId, JSON.stringify(input.budgets))),
        ),
        Effect.andThen(snapshot.pipe(Effect.mapError(toAutonomyFailure))),
      ),
    stopAll: () =>
      preferences
        .setStoppedAll(true)
        .pipe(
          Effect.mapError(toAutonomyFailure),
          Effect.andThen(service.stopAll()),
          Effect.andThen(snapshot.pipe(Effect.mapError(toAutonomyFailure))),
        ),
    resumeAll: () =>
      preferences
        .setStoppedAll(false)
        .pipe(
          Effect.mapError(toAutonomyFailure),
          Effect.andThen(service.resumeAll()),
          Effect.andThen(snapshot.pipe(Effect.mapError(toAutonomyFailure))),
        ),
    listAuditLog: (filter) =>
      Effect.try({
        try: () => audit.list(filter),
        catch: toAutonomyFailure,
      }),
  };
}
