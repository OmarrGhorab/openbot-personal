import {
  type AgentBudgetLimits,
  type AgentBudgets,
  type BudgetLimitKind,
  MAX_BUDGET_COST_USD,
  MAX_BUDGET_MINUTES,
  MAX_BUDGET_TOKENS,
} from "@openbot/contracts/ipc";

/** One limit as the person types it: the empty string is no limit. */
type BudgetLimitDraft = Record<BudgetLimitKind, string>;

export interface BudgetDraft {
  perTask: BudgetLimitDraft;
  perDay: BudgetLimitDraft;
}

const MAXIMUM: Record<BudgetLimitKind, number> = {
  tokens: MAX_BUDGET_TOKENS,
  minutes: MAX_BUDGET_MINUTES,
  costUsd: MAX_BUDGET_COST_USD,
};

function draftOf(limits: AgentBudgetLimits): BudgetLimitDraft {
  return {
    tokens: limits.tokens === null ? "" : String(limits.tokens),
    minutes: limits.minutes === null ? "" : String(limits.minutes),
    costUsd: limits.costUsd === null ? "" : String(limits.costUsd),
  };
}

/** The text fields that show the stored budgets. */
export function budgetDraftOf(budgets: AgentBudgets): BudgetDraft {
  return { perTask: draftOf(budgets.perTask), perDay: draftOf(budgets.perDay) };
}

function parseLimit(text: string, kind: BudgetLimitKind): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || value > MAXIMUM[kind]) return undefined;
  return value;
}

/**
 * The budgets that the fields hold, or null when a field is not a number above zero within its
 * limit. An empty field is no limit.
 */
export function parseBudgetDraft(draft: BudgetDraft): AgentBudgets | null {
  const scope = (limits: BudgetLimitDraft): AgentBudgetLimits | null => {
    const tokens = parseLimit(limits.tokens, "tokens");
    const minutes = parseLimit(limits.minutes, "minutes");
    const costUsd = parseLimit(limits.costUsd, "costUsd");
    if (tokens === undefined || minutes === undefined || costUsd === undefined) return null;
    return { tokens, minutes, costUsd };
  };
  const perTask = scope(draft.perTask);
  const perDay = scope(draft.perDay);
  return perTask && perDay ? { perTask, perDay } : null;
}

/** The estimated cost, as dollars, or null when no turn had a price. */
export function formatUsageCost(costUsd: number | null): string | null {
  if (costUsd === null) return null;
  if (costUsd > 0 && costUsd < 0.01) return "<$0.01";
  return `$${costUsd.toFixed(2)}`;
}
