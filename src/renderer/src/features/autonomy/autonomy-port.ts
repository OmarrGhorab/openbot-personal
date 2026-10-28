import type {
  AutonomyAuditFilter,
  AutonomyAuditPage,
  AutonomySnapshot,
  SetAgentApprovalRulesInput,
  SetAgentBudgetsInput,
} from "@openbot/contracts/ipc";

/**
 * What the safety settings and the sidebar reach in main: the rules, budgets, usage and stop of the
 * agents of this computer, and the audit log. Read on each call, so a test that replaces
 * `window.openbot` takes effect.
 */
interface AutonomyPort {
  getSnapshot(): Promise<AutonomySnapshot>;
  setApprovalRules(input: SetAgentApprovalRulesInput): Promise<AutonomySnapshot>;
  setBudgets(input: SetAgentBudgetsInput): Promise<AutonomySnapshot>;
  stopAll(): Promise<AutonomySnapshot>;
  resumeAll(): Promise<AutonomySnapshot>;
  listAuditLog(filter: AutonomyAuditFilter): Promise<AutonomyAuditPage>;
}

export function autonomyPort(): AutonomyPort {
  return window.openbot.autonomy;
}
