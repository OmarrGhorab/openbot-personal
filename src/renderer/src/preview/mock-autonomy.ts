import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import {
  type AgentApprovalRules,
  type AgentBudgets,
  type AutonomyAgentSettings,
  type AutonomyAuditEntry,
  type AutonomyAuditFilter,
  type AutonomyAuditPage,
  type AutonomySnapshot,
  DEFAULT_AGENT_APPROVAL_RULES,
  DEFAULT_AGENT_BUDGETS,
  type SetAgentApprovalRulesInput,
  type SetAgentBudgetsInput,
} from "@openbot/contracts/ipc";

type AutonomyApi = OpenBotDesktopApi["autonomy"];

const ZERO = { tokens: 0, minutes: 0, costUsd: null };

/**
 * The autonomy group of the preview. It keeps the rules, budgets and the stop in memory, so the
 * settings screen works in a preview. It does not run agents, so the audit log starts empty.
 */
export function createMockAutonomy(agents: () => Array<{ id: string; name: string }>): AutonomyApi {
  const rules = new Map<string, AgentApprovalRules>();
  const budgets = new Map<string, AgentBudgets>();
  const entries: AutonomyAuditEntry[] = [];
  let stoppedAll = false;

  const snapshot = (): AutonomySnapshot => {
    const list: AutonomyAgentSettings[] = agents().map((agent) => ({
      agentId: agent.id,
      agentName: agent.name,
      approvals: rules.get(agent.id) ?? DEFAULT_AGENT_APPROVAL_RULES,
      budgets: budgets.get(agent.id) ?? DEFAULT_AGENT_BUDGETS,
      today: ZERO,
      tasks: [],
    }));
    return { stoppedAll, agents: list };
  };

  const record = (action: AutonomyAuditEntry["action"], agentId: string | null, detail: string) => {
    entries.unshift({
      eventId: entries.length + 1,
      occurredAt: new Date().toISOString(),
      action,
      agentId,
      threadId: null,
      taskId: null,
      risk: null,
      result: "saved",
      target: agentId ?? "all agents",
      detail,
    });
  };

  return {
    getSnapshot: async () => snapshot(),
    setApprovalRules: async (input: SetAgentApprovalRulesInput) => {
      rules.set(input.agentId, input.approvals);
      record("rules.changed", input.agentId, `medium=${input.approvals.medium}`);
      return snapshot();
    },
    setBudgets: async (input: SetAgentBudgetsInput) => {
      budgets.set(input.agentId, input.budgets);
      record("budgets.changed", input.agentId, JSON.stringify(input.budgets));
      return snapshot();
    },
    stopAll: async () => {
      stoppedAll = true;
      record("stop-all.started", null, "0 running turns stopped");
      return snapshot();
    },
    resumeAll: async () => {
      stoppedAll = false;
      record("stop-all.resumed", null, "");
      return snapshot();
    },
    listAuditLog: async (filter: AutonomyAuditFilter): Promise<AutonomyAuditPage> => {
      const matching = entries.filter(
        (entry) =>
          (filter.agentId === undefined || entry.agentId === filter.agentId) &&
          (filter.action === undefined || entry.action === filter.action) &&
          (filter.risk === undefined || entry.risk === filter.risk),
      );
      const limit = filter.limit ?? 50;
      return { entries: matching.slice(0, limit), nextBefore: null };
    },
  };
}
