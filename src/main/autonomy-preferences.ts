import {
  type AgentApprovalRules,
  type AgentBudgets,
  DEFAULT_AGENT_APPROVAL_RULES,
  DEFAULT_AGENT_BUDGETS,
  isAgentApprovalRules,
  isAgentBudgets,
  type SetAgentApprovalRulesInput,
  type SetAgentBudgetsInput,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import type { AutonomyPolicy } from "../backend/autonomy/autonomy-policy";
import { type PreferenceFileFailure, PreferenceStore } from "./preference-file";

/** The file that holds the graded permissions, the budgets and Stop all agents of this computer. */
export const AUTONOMY_PREFERENCE_FILE = "openbot-autonomy-v1.json";

interface AgentAutonomyPreference {
  approvals: AgentApprovalRules;
  budgets: AgentBudgets;
}

interface AutonomyPreference {
  stoppedAll: boolean;
  agents: Record<string, AgentAutonomyPreference>;
}

const EMPTY_PREFERENCE: AutonomyPreference = { stoppedAll: false, agents: {} };

/**
 * A file that does not decode reads as the defaults: both risk levels ask, and no budget or stop is
 * set. An agent entry that does not decode is dropped, so the agent gets the defaults too.
 */
function decodeAutonomyPreference(value: unknown): AutonomyPreference | null {
  if (!isDynamicRecord(value) || !isBoolean(value.stoppedAll) || !isDynamicRecord(value.agents)) return null;
  const agents: Record<string, AgentAutonomyPreference> = {};
  for (const [agentId, entry] of Object.entries(value.agents)) {
    if (!isDynamicRecord(entry) || !isAgentApprovalRules(entry.approvals) || !isAgentBudgets(entry.budgets)) continue;
    agents[agentId] = { approvals: entry.approvals, budgets: entry.budgets };
  }
  return { stoppedAll: value.stoppedAll, agents };
}

/**
 * The person's graded permissions, budgets and Stop all agents, kept in one versioned file. The agent
 * service reads it through `AutonomyPolicy` at each decision, so a change applies to the next one.
 *
 * Writes run one at a time, so two changes made at once keep both.
 */
export class AutonomyPreferences implements AutonomyPolicy {
  readonly #store: PreferenceStore<AutonomyPreference>;
  readonly #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#store = new PreferenceStore({
      path,
      defaultValue: EMPTY_PREFERENCE,
      decode: decodeAutonomyPreference,
    });
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return this.#store.load();
  }

  approvalRules(agentId: string): AgentApprovalRules {
    return this.#store.get().agents[agentId]?.approvals ?? DEFAULT_AGENT_APPROVAL_RULES;
  }

  budgets(agentId: string): AgentBudgets {
    return this.#store.get().agents[agentId]?.budgets ?? DEFAULT_AGENT_BUDGETS;
  }

  stoppedAll(): boolean {
    return this.#store.get().stoppedAll;
  }

  setApprovalRules(input: SetAgentApprovalRulesInput): Effect.Effect<void, PreferenceFileFailure> {
    return this.#updateAgent(input.agentId, (current) => ({ ...current, approvals: input.approvals }));
  }

  setBudgets(input: SetAgentBudgetsInput): Effect.Effect<void, PreferenceFileFailure> {
    return this.#updateAgent(input.agentId, (current) => ({ ...current, budgets: input.budgets }));
  }

  setStoppedAll(stoppedAll: boolean): Effect.Effect<void, PreferenceFileFailure> {
    return this.#writes.withPermit(Effect.suspend(() => this.#store.set({ ...this.#store.get(), stoppedAll })));
  }

  #updateAgent(
    agentId: string,
    change: (current: AgentAutonomyPreference) => AgentAutonomyPreference,
  ): Effect.Effect<void, PreferenceFileFailure> {
    return this.#writes.withPermit(
      Effect.suspend(() => {
        const state = this.#store.get();
        const current = state.agents[agentId] ?? {
          approvals: DEFAULT_AGENT_APPROVAL_RULES,
          budgets: DEFAULT_AGENT_BUDGETS,
        };
        return this.#store.set({ ...state, agents: { ...state.agents, [agentId]: change(current) } });
      }),
    );
  }
}
