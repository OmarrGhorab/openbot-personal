import {
  type ActionRiskLevel,
  type AgentApprovalRules,
  type AgentBudgets,
  DEFAULT_AGENT_APPROVAL_RULES,
  DEFAULT_AGENT_BUDGETS,
} from "@openbot/contracts/ipc";

/**
 * What the person chose for graded permissions and budgets. Main owns the settings file and passes
 * this to the agent service, which reads it at each decision: a change applies to the next check.
 */
export interface AutonomyPolicy {
  approvalRules(agentId: string): AgentApprovalRules;
  budgets(agentId: string): AgentBudgets;
  /** Stop all agents is on. Read at each drain, so it holds every lane of every agent at once. */
  stoppedAll(): boolean;
}

export const DEFAULT_AUTONOMY_POLICY: AutonomyPolicy = {
  approvalRules: () => DEFAULT_AGENT_APPROVAL_RULES,
  budgets: () => DEFAULT_AGENT_BUDGETS,
  stoppedAll: () => false,
};

/** Whether an action at this level asks the person first. A low-risk action never asks. */
export function levelAsks(rules: AgentApprovalRules, level: ActionRiskLevel): boolean {
  if (level === "low") return false;
  return rules[level];
}
