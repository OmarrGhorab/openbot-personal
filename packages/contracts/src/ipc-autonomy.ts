/**
 * Graded permissions, budgets, the audit log and Stop all agents (issue #126, autonomy 7).
 *
 * Risk levels classify an action before a tool call runs. `low` never asks. `medium` and `high` ask
 * unless the person changes the agent's rule. The defaults ask for both, so nothing changes for an
 * agent until the person changes it. Budgets bound the tokens, the wall time and the estimated cost
 * of a work thread and of an agent per day. The audit log records each autonomous action.
 */
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export const ACTION_RISK_LEVELS = ["low", "medium", "high"] as const;
export type ActionRiskLevel = (typeof ACTION_RISK_LEVELS)[number];

/** Whether each level asks first. `low` is not configurable: a low-risk action never asks. */
export interface AgentApprovalRules {
  medium: boolean;
  high: boolean;
}

export const DEFAULT_AGENT_APPROVAL_RULES: AgentApprovalRules = { medium: true, high: true };

/** A limit of `null` is off. A positive number is the most the scope may use. */
export interface AgentBudgetLimits {
  tokens: number | null;
  minutes: number | null;
  costUsd: number | null;
}

export interface AgentBudgets {
  /** Per work thread. The agent's main chat has no task, so only `perDay` applies to it. */
  perTask: AgentBudgetLimits;
  /** Per agent, counted from local midnight. */
  perDay: AgentBudgetLimits;
}

const NO_AGENT_BUDGET_LIMITS: AgentBudgetLimits = { tokens: null, minutes: null, costUsd: null };
export const DEFAULT_AGENT_BUDGETS: AgentBudgets = { perTask: NO_AGENT_BUDGET_LIMITS, perDay: NO_AGENT_BUDGET_LIMITS };

/** The limits that a budget can name. */
export const BUDGET_LIMIT_KINDS = ["tokens", "minutes", "costUsd"] as const;
export type BudgetLimitKind = (typeof BUDGET_LIMIT_KINDS)[number];

export const MAX_BUDGET_TOKENS = 1_000_000_000;
export const MAX_BUDGET_MINUTES = 100_000;
export const MAX_BUDGET_COST_USD = 100_000;

/** Used amounts of one scope. `costUsd` is null when no turn in the scope reported a price. */
export interface AgentUsageTotals {
  tokens: number;
  minutes: number;
  costUsd: number | null;
}

export interface AutonomyTaskUsage {
  taskId: string;
  title: string;
  totals: AgentUsageTotals;
  /** The limit that stopped the task, or null. */
  exceeded: BudgetLimitKind | null;
}

export interface AutonomyAgentSettings {
  agentId: string;
  agentName: string;
  approvals: AgentApprovalRules;
  budgets: AgentBudgets;
  today: AgentUsageTotals;
  /** The usage of each work thread of the agent, newest first. */
  tasks: AutonomyTaskUsage[];
}

export interface AutonomySnapshot {
  /** Stop all agents is on: no lane of any agent starts a turn until it is resumed. */
  stoppedAll: boolean;
  agents: AutonomyAgentSettings[];
}

export const AUTONOMY_AUDIT_ACTIONS = [
  "approval.auto",
  "approval.asked",
  "approval.accepted",
  "approval.declined",
  "budget.stopped",
  "stop-all.started",
  "stop-all.resumed",
  "rules.changed",
  "budgets.changed",
] as const;
export type AutonomyAuditAction = (typeof AUTONOMY_AUDIT_ACTIONS)[number];

export const AUTONOMY_AUDIT_RESULTS = [
  "approved",
  "asked",
  "accepted",
  "declined",
  "stopped",
  "started",
  "resumed",
  "saved",
] as const;
export type AutonomyAuditResult = (typeof AUTONOMY_AUDIT_RESULTS)[number];

export interface AutonomyAuditEntry {
  eventId: number;
  occurredAt: string;
  action: AutonomyAuditAction;
  agentId: string | null;
  threadId: string | null;
  taskId: string | null;
  risk: ActionRiskLevel | null;
  result: AutonomyAuditResult;
  /** The command, file or setting the action touched. Secrets are masked before it is stored. */
  target: string;
  /** A short reason or a change summary. Secrets are masked before it is stored. */
  detail: string;
}

export interface AutonomyAuditFilter {
  agentId?: string;
  action?: AutonomyAuditAction;
  risk?: ActionRiskLevel;
  /** Returns entries older than this event id. */
  before?: number;
  limit?: number;
}

export interface AutonomyAuditPage {
  entries: AutonomyAuditEntry[];
  /** Pass as `before` for the next page, or null when this is the last page. */
  nextBefore: number | null;
}

export const MAX_AUDIT_PAGE_SIZE = 200;

export interface SetAgentApprovalRulesInput {
  agentId: string;
  approvals: AgentApprovalRules;
}

export interface SetAgentBudgetsInput {
  agentId: string;
  budgets: AgentBudgets;
}

export function isAgentApprovalRules(value: unknown): value is AgentApprovalRules {
  return isDynamicRecord(value) && isBoolean(value.medium) && isBoolean(value.high);
}

function isBudgetLimit(value: unknown, maximum: number): value is number | null {
  return value === null || (isNumber(value) && Number.isFinite(value) && value > 0 && value <= maximum);
}

function isAgentBudgetLimits(value: unknown): value is AgentBudgetLimits {
  return (
    isDynamicRecord(value) &&
    isBudgetLimit(value.tokens, MAX_BUDGET_TOKENS) &&
    isBudgetLimit(value.minutes, MAX_BUDGET_MINUTES) &&
    isBudgetLimit(value.costUsd, MAX_BUDGET_COST_USD)
  );
}

export function isAgentBudgets(value: unknown): value is AgentBudgets {
  return isDynamicRecord(value) && isAgentBudgetLimits(value.perTask) && isAgentBudgetLimits(value.perDay);
}

function isAutonomyAuditFilter(value: unknown): value is AutonomyAuditFilter {
  return (
    isDynamicRecord(value) &&
    (value.agentId === undefined || isIdentifier(value.agentId)) &&
    (value.action === undefined || isOneOf(AUTONOMY_AUDIT_ACTIONS, value.action)) &&
    (value.risk === undefined || isOneOf(ACTION_RISK_LEVELS, value.risk)) &&
    (value.before === undefined ||
      (isNumber(value.before) && Number.isSafeInteger(value.before) && value.before > 0)) &&
    (value.limit === undefined ||
      (isNumber(value.limit) &&
        Number.isSafeInteger(value.limit) &&
        value.limit > 0 &&
        value.limit <= MAX_AUDIT_PAGE_SIZE))
  );
}

function isUsageTotals(value: unknown): value is AgentUsageTotals {
  return (
    isDynamicRecord(value) &&
    isNumber(value.tokens) &&
    isNumber(value.minutes) &&
    (value.costUsd === null || isNumber(value.costUsd))
  );
}

function isAutonomySnapshot(value: unknown): value is AutonomySnapshot {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.stoppedAll) &&
    Array.isArray(value.agents) &&
    value.agents.every(
      (agent) =>
        isDynamicRecord(agent) &&
        isIdentifier(agent.agentId) &&
        isBoundedString(agent.agentName, 500) &&
        isAgentApprovalRules(agent.approvals) &&
        isAgentBudgets(agent.budgets) &&
        isUsageTotals(agent.today) &&
        Array.isArray(agent.tasks),
    )
  );
}

export function decodeAutonomySnapshot(value: unknown): AutonomySnapshot {
  if (!isAutonomySnapshot(value)) throw new Error("Invalid autonomy snapshot response.");
  return value;
}

function isAutonomyAuditPage(value: unknown): value is AutonomyAuditPage {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.entries) &&
    (value.nextBefore === null || isNumber(value.nextBefore)) &&
    value.entries.every(
      (entry) =>
        isDynamicRecord(entry) &&
        isNumber(entry.eventId) &&
        isString(entry.occurredAt) &&
        isOneOf(AUTONOMY_AUDIT_ACTIONS, entry.action) &&
        isOneOf(AUTONOMY_AUDIT_RESULTS, entry.result) &&
        isString(entry.target) &&
        isString(entry.detail),
    )
  );
}

export function decodeAutonomyAuditPage(value: unknown): AutonomyAuditPage {
  if (!isAutonomyAuditPage(value)) throw new Error("Invalid autonomy audit response.");
  return value;
}

function isSetAgentApprovalRulesInput(value: unknown): value is SetAgentApprovalRulesInput {
  return isDynamicRecord(value) && isIdentifier(value.agentId) && isAgentApprovalRules(value.approvals);
}

function isSetAgentBudgetsInput(value: unknown): value is SetAgentBudgetsInput {
  return isDynamicRecord(value) && isIdentifier(value.agentId) && isAgentBudgets(value.budgets);
}

export function parseSetAgentApprovalRulesInput(value: unknown): SetAgentApprovalRulesInput {
  if (!isSetAgentApprovalRulesInput(value)) throw new Error("Invalid approval rules update.");
  return { agentId: value.agentId, approvals: { medium: value.approvals.medium, high: value.approvals.high } };
}

export function parseSetAgentBudgetsInput(value: unknown): SetAgentBudgetsInput {
  if (!isSetAgentBudgetsInput(value)) throw new Error("Invalid budget update.");
  return { agentId: value.agentId, budgets: value.budgets };
}

export function parseAutonomyAuditFilter(value: unknown): AutonomyAuditFilter {
  if (value === undefined || value === null) return {};
  if (!isAutonomyAuditFilter(value)) throw new Error("Invalid audit log filter.");
  const filter: AutonomyAuditFilter = {};
  if (value.agentId !== undefined) filter.agentId = value.agentId;
  if (value.action !== undefined) filter.action = value.action;
  if (value.risk !== undefined) filter.risk = value.risk;
  if (value.before !== undefined) filter.before = value.before;
  if (value.limit !== undefined) filter.limit = value.limit;
  return filter;
}

/**
 * The first limit that `totals` has reached, in the order tokens, minutes, cost. A limit that is
 * off never stops work. A cost limit with no measured cost does not stop work either: the cost is
 * not known, and the UI says so.
 */
export function exceededBudgetLimit(limits: AgentBudgetLimits, totals: AgentUsageTotals): BudgetLimitKind | null {
  if (limits.tokens !== null && totals.tokens >= limits.tokens) return "tokens";
  if (limits.minutes !== null && totals.minutes >= limits.minutes) return "minutes";
  if (limits.costUsd !== null && totals.costUsd !== null && totals.costUsd >= limits.costUsd) return "costUsd";
  return null;
}
