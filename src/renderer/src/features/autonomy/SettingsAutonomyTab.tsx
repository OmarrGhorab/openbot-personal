import {
  ACTION_RISK_LEVELS,
  type ActionRiskLevel,
  type AgentUsageTotals,
  AUTONOMY_AUDIT_ACTIONS,
  type AutonomyAgentSettings,
  type AutonomyAuditAction,
  type AutonomyAuditEntry,
  type AutonomyAuditFilter,
  type AutonomySnapshot,
  BUDGET_LIMIT_KINDS,
  type BudgetLimitKind,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Button,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  SwitchField,
  Text,
  toast,
} from "@openbot/ui";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { type BudgetDraft, budgetDraftOf, formatUsageCost, parseBudgetDraft } from "./autonomy-format";
import { autonomyPort } from "./autonomy-port";

/** The label of each action of the audit log. A map to keys, so the text follows the language. */
const ACTION_LABEL = {
  "approval.auto": "autonomy.audit.action.approval.auto",
  "approval.asked": "autonomy.audit.action.approval.asked",
  "approval.accepted": "autonomy.audit.action.approval.accepted",
  "approval.declined": "autonomy.audit.action.approval.declined",
  "budget.stopped": "autonomy.audit.action.budget.stopped",
  "stop-all.started": "autonomy.audit.action.stop-all.started",
  "stop-all.resumed": "autonomy.audit.action.stop-all.resumed",
  "rules.changed": "autonomy.audit.action.rules.changed",
  "budgets.changed": "autonomy.audit.action.budgets.changed",
} as const satisfies Record<AutonomyAuditAction, AppTextKey>;

const RISK_LABEL = {
  low: "autonomy.audit.risk.low",
  medium: "autonomy.audit.risk.medium",
  high: "autonomy.audit.risk.high",
} as const satisfies Record<ActionRiskLevel, AppTextKey>;

const LIMIT_LABEL = {
  tokens: "autonomy.budgets.tokens",
  minutes: "autonomy.budgets.minutes",
  costUsd: "autonomy.budgets.costUsd",
} as const satisfies Record<BudgetLimitKind, AppTextKey>;

const ACTIONS = AUTONOMY_AUDIT_ACTIONS;
const RISKS = ACTION_RISK_LEVELS;
const LIMITS = BUDGET_LIMIT_KINDS;
const SCOPES = ["perTask", "perDay"] as const;

const SCOPE_LABEL = {
  perTask: "autonomy.budgets.perTask",
  perDay: "autonomy.budgets.perDay",
} as const satisfies Record<(typeof SCOPES)[number], AppTextKey>;

const PAGE_SIZE = 50;

/** The value of the "All ..." choice of an audit filter. It is never an agent id, a risk or an action. */
const ANY = "*";

/** One choice of a settings select: the stored value and its visible name. */
interface Choice {
  id: string;
  label: string;
}

interface SettingsAutonomyTabProps {
  /** The dialog element the Select popovers portal into, captured when the tab was created. */
  selectMount?: HTMLElement | undefined;
}

/**
 * The safety settings of the agents on this computer: the approval rules and budgets of each agent,
 * its usage, and the audit log. Stop all agents is in the sidebar header, where it is always in reach.
 */
export function SettingsAutonomyTab(props: SettingsAutonomyTabProps) {
  const i18n = useI18n();
  const [snapshot, setSnapshot] = createSignal<AutonomySnapshot | null>(null);
  const [loadFailed, setLoadFailed] = createSignal(false);
  const [chosenAgentId, setChosenAgentId] = createSignal("");
  const [draft, setDraft] = createSignal<BudgetDraft | null>(null);

  const agents = () => snapshot()?.agents ?? [];
  const selected = createMemo<AutonomyAgentSettings | undefined>(
    () => agents().find((agent) => agent.agentId === chosenAgentId()) ?? agents()[0],
  );

  const reportFailure = (key: AppTextKey) =>
    toast.error(i18n.t(key), { report: { operation: "settings", source: "system", cause_code: "unknown" } });

  const applySnapshot = (next: AutonomySnapshot) => {
    setSnapshot(next);
    setLoadFailed(false);
  };

  const reload = () =>
    Promise.resolve()
      .then(() => autonomyPort().getSnapshot())
      .then(applySnapshot)
      .catch(() => setLoadFailed(true));

  /** The budget fields of the selected agent: what the person typed, or the stored limits. */
  const fields = (): BudgetDraft | null => {
    const agent = selected();
    if (!agent) return null;
    return draft() ?? budgetDraftOf(agent.budgets);
  };

  const setRule = (level: "medium" | "high", ask: boolean) => {
    const agent = selected();
    if (!agent) return;
    autonomyPort()
      .setApprovalRules({ agentId: agent.agentId, approvals: { ...agent.approvals, [level]: ask } })
      .then(applySnapshot)
      .catch(() => reportFailure("autonomy.approvals.saveFailed"));
  };

  const saveBudgets = () => {
    const agent = selected();
    const current = fields();
    if (!agent || !current) return;
    const budgets = parseBudgetDraft(current);
    if (!budgets) {
      reportFailure("autonomy.budgets.invalid");
      return;
    }
    autonomyPort()
      .setBudgets({ agentId: agent.agentId, budgets })
      .then((next) => {
        applySnapshot(next);
        setDraft(null);
      })
      .catch(() => reportFailure("autonomy.budgets.saveFailed"));
  };

  const typeBudget = (scope: keyof BudgetDraft, kind: BudgetLimitKind, text: string) => {
    const current = fields();
    if (!current) return;
    setDraft({ ...current, [scope]: { ...current[scope], [kind]: text } });
  };

  // The audit log has its own filters and paging, apart from the selected agent.
  const [auditAgent, setAuditAgent] = createSignal(ANY);
  const [auditRisk, setAuditRisk] = createSignal(ANY);
  const [auditAction, setAuditAction] = createSignal(ANY);
  const [entries, setEntries] = createSignal<AutonomyAuditEntry[]>([]);
  const [nextBefore, setNextBefore] = createSignal<number | null>(null);
  const [auditFailed, setAuditFailed] = createSignal(false);

  const auditFilter = (before?: number): AutonomyAuditFilter => {
    const filter: AutonomyAuditFilter = { limit: PAGE_SIZE };
    if (auditAgent() !== ANY) filter.agentId = auditAgent();
    const risk = auditRisk();
    if (isOneOf(ACTION_RISK_LEVELS, risk)) filter.risk = risk;
    const action = auditAction();
    if (isOneOf(AUTONOMY_AUDIT_ACTIONS, action)) filter.action = action;
    if (before !== undefined) filter.before = before;
    return filter;
  };

  /** Loads the first page of the filters, or the next page after `before`. */
  const loadAudit = (before?: number) =>
    autonomyPort()
      .listAuditLog(auditFilter(before))
      .then((page) => {
        setEntries(before === undefined ? page.entries : [...entries(), ...page.entries]);
        setNextBefore(page.nextBefore);
        setAuditFailed(false);
      })
      .catch(() => setAuditFailed(true));

  const agentName = (agentId: string | null) => agents().find((agent) => agent.agentId === agentId)?.agentName;

  const agentChoices = (): Choice[] => agents().map((agent) => ({ id: agent.agentId, label: agent.agentName }));
  const auditAgentChoices = (): Choice[] => [
    { id: ANY, label: i18n.t("autonomy.audit.filter.allAgents") },
    ...agentChoices(),
  ];
  const auditRiskChoices = (): Choice[] => [
    { id: ANY, label: i18n.t("autonomy.audit.filter.allRisks") },
    ...RISKS.map((risk) => ({ id: risk, label: i18n.t(RISK_LABEL[risk]) })),
  ];
  const auditActionChoices = (): Choice[] => [
    { id: ANY, label: i18n.t("autonomy.audit.filter.allActions") },
    ...ACTIONS.map((action) => ({ id: action, label: i18n.t(ACTION_LABEL[action]) })),
  ];

  /** Sets one audit filter and loads the first page again. */
  const filterAudit = (set: (value: string) => void) => (value: string) => {
    set(value);
    void loadAudit();
  };

  onSettled(() => {
    void reload();
    void loadAudit();
  });

  return (
    <>
      <Show when={snapshot()?.stoppedAll}>
        <Text as="p" variant="caption" tone="muted">
          {i18n.t("autonomy.tab.stoppedNotice")}
        </Text>
      </Show>
      <Show when={loadFailed()}>
        <Text as="p" variant="caption" tone="muted">
          {i18n.t("autonomy.tab.loadFailed")}
        </Text>
      </Show>

      <Show
        when={selected()}
        fallback={
          <Text as="p" variant="caption" tone="muted">
            {i18n.t("autonomy.tab.noAgents")}
          </Text>
        }
      >
        {(agent) => (
          <>
            <SettingsSection title={i18n.t("autonomy.tab.agent")}>
              <ItemGroup class="settings-modal-card">
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemDescription>{i18n.t("autonomy.tab.agentDescription")}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ChoiceSelect
                      label={i18n.t("autonomy.tab.agent")}
                      choices={agentChoices()}
                      value={agent().agentId}
                      mount={props.selectMount}
                      onChange={(agentId) => {
                        setChosenAgentId(agentId);
                        setDraft(null);
                      }}
                    />
                  </ItemActions>
                </Item>
              </ItemGroup>
            </SettingsSection>

            <SettingsSection
              title={i18n.t("autonomy.approvals.title")}
              description={i18n.t("autonomy.approvals.description")}
            >
              <ItemGroup class="settings-modal-card">
                <Item>
                  <ItemContent>
                    <ItemDescription>{i18n.t("autonomy.approvals.low")}</ItemDescription>
                  </ItemContent>
                </Item>
                <SwitchField
                  checked={agent().approvals.medium}
                  onChange={(ask) => setRule("medium", ask)}
                  label={i18n.t("autonomy.approvals.medium.title")}
                  description={i18n.t("autonomy.approvals.medium.description")}
                />
                <SwitchField
                  checked={agent().approvals.high}
                  onChange={(ask) => setRule("high", ask)}
                  label={i18n.t("autonomy.approvals.high.title")}
                  description={i18n.t("autonomy.approvals.high.description")}
                />
              </ItemGroup>
            </SettingsSection>

            <SettingsSection
              title={i18n.t("autonomy.budgets.title")}
              description={i18n.t("autonomy.budgets.description")}
            >
              <ItemGroup class="settings-modal-card">
                <For each={SCOPES}>
                  {(scope) => (
                    <For each={LIMITS}>
                      {(kind) => (
                        <Item class="settings-modal-row">
                          <ItemContent>
                            <ItemTitle>{i18n.t(LIMIT_LABEL[kind])}</ItemTitle>
                            <ItemDescription>{i18n.t(SCOPE_LABEL[scope])}</ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <Input
                              class="settings-modal-number-input"
                              aria-label={`${i18n.t(SCOPE_LABEL[scope])} ${i18n.t(LIMIT_LABEL[kind])}`}
                              type="number"
                              inputmode="decimal"
                              min="0"
                              step="any"
                              value={fields()?.[scope][kind] ?? ""}
                              onValueChange={(text) => typeBudget(scope, kind, text)}
                            />
                          </ItemActions>
                        </Item>
                      )}
                    </For>
                  )}
                </For>
              </ItemGroup>
              <div class="settings-modal-save-actions settings-autonomy-budget-actions">
                <Text as="p" variant="caption" tone="muted">
                  {i18n.t("autonomy.budgets.costNote")}
                </Text>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={draft() === null}
                  onClick={() => setDraft(null)}
                >
                  {i18n.t("autonomy.budgets.reset")}
                </Button>
                <Button type="button" size="sm" variant="default" disabled={draft() === null} onClick={saveBudgets}>
                  {i18n.t("autonomy.budgets.save")}
                </Button>
              </div>
            </SettingsSection>

            <SettingsSection title={i18n.t("autonomy.usage.title")}>
              <ItemGroup class="settings-modal-card">
                <Item>
                  <ItemContent>
                    <ItemTitle>{i18n.t("autonomy.usage.today")}</ItemTitle>
                    <ItemDescription>{usageSummary(agent().today, i18n)}</ItemDescription>
                  </ItemContent>
                </Item>
                <Show
                  when={agent().tasks.length > 0}
                  fallback={
                    <Item>
                      <ItemContent>
                        <ItemDescription>{i18n.t("autonomy.usage.none")}</ItemDescription>
                      </ItemContent>
                    </Item>
                  }
                >
                  <For each={agent().tasks}>
                    {(task) => (
                      <Item>
                        <ItemContent>
                          <ItemTitle>{task.title}</ItemTitle>
                          <ItemDescription>{usageSummary(task.totals, i18n)}</ItemDescription>
                        </ItemContent>
                        <Show when={task.exceeded}>
                          {(limit) => (
                            <ItemActions>
                              <Badge variant="destructive">
                                {i18n.t("autonomy.usage.limitReached", { limit: i18n.t(LIMIT_LABEL[limit()]) })}
                              </Badge>
                            </ItemActions>
                          )}
                        </Show>
                      </Item>
                    )}
                  </For>
                </Show>
              </ItemGroup>
            </SettingsSection>
          </>
        )}
      </Show>

      <SettingsSection title={i18n.t("autonomy.audit.title")} description={i18n.t("autonomy.audit.description")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("autonomy.audit.filter.agent")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ChoiceSelect
                label={i18n.t("autonomy.audit.filter.agent")}
                choices={auditAgentChoices()}
                value={auditAgent()}
                mount={props.selectMount}
                onChange={filterAudit(setAuditAgent)}
              />
            </ItemActions>
          </Item>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("autonomy.audit.filter.risk")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ChoiceSelect
                label={i18n.t("autonomy.audit.filter.risk")}
                choices={auditRiskChoices()}
                value={auditRisk()}
                mount={props.selectMount}
                onChange={filterAudit(setAuditRisk)}
              />
            </ItemActions>
          </Item>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("autonomy.audit.filter.action")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ChoiceSelect
                label={i18n.t("autonomy.audit.filter.action")}
                choices={auditActionChoices()}
                value={auditAction()}
                mount={props.selectMount}
                onChange={filterAudit(setAuditAction)}
              />
            </ItemActions>
          </Item>
        </ItemGroup>

        <Show when={auditFailed()}>
          <Text as="p" variant="caption" tone="muted">
            {i18n.t("autonomy.audit.loadFailed")}
          </Text>
        </Show>
        <Show
          when={entries().length > 0}
          fallback={
            <Text as="p" variant="caption" tone="muted">
              {i18n.t("autonomy.audit.empty")}
            </Text>
          }
        >
          <ItemGroup class="settings-modal-card">
            <For each={entries()}>
              {(entry) => (
                <Item>
                  <ItemContent>
                    <ItemTitle>
                      {entry.risk
                        ? `${i18n.t(ACTION_LABEL[entry.action])} · ${i18n.t(RISK_LABEL[entry.risk])}`
                        : i18n.t(ACTION_LABEL[entry.action])}
                    </ItemTitle>
                    <ItemDescription>
                      {[agentName(entry.agentId), new Date(entry.occurredAt).toLocaleString(), entry.result]
                        .filter((part) => part !== undefined && part !== null && part !== "")
                        .join(" · ")}
                    </ItemDescription>
                    <Show when={entry.target}>
                      <code>{entry.target}</code>
                    </Show>
                    <Show when={entry.detail}>
                      <Text as="p" variant="caption" tone="muted">
                        {entry.detail}
                      </Text>
                    </Show>
                  </ItemContent>
                </Item>
              )}
            </For>
          </ItemGroup>
        </Show>
        <Show when={nextBefore() !== null}>
          <div>
            <Button type="button" variant="ghost" onClick={() => void loadAudit(nextBefore() ?? undefined)}>
              {i18n.t("autonomy.audit.loadMore")}
            </Button>
          </div>
        </Show>
      </SettingsSection>
    </>
  );
}

/** A settings select of plain choices, in the size and width of the other settings rows. */
function ChoiceSelect(props: {
  label: string;
  choices: Choice[];
  value: string;
  mount: HTMLElement | undefined;
  onChange: (id: string) => void;
}) {
  const selected = () => props.choices.find((choice) => choice.id === props.value) ?? null;
  return (
    <Select<Choice>
      class="settings-modal-select"
      options={props.choices}
      value={selected()}
      optionValue="id"
      optionTextValue="label"
      placement="bottom-end"
      onChange={(choice) => {
        if (choice) props.onChange(choice.id);
      }}
      itemComponent={(selectProps) => (
        <SelectItem item={selectProps.item}>{selectProps.item.rawValue.label}</SelectItem>
      )}
    >
      <SelectTrigger size="sm" aria-label={props.label}>
        <SelectValue<Choice>>{(state) => state.selectedOption()?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}

function usageSummary(totals: AgentUsageTotals, i18n: ReturnType<typeof useI18n>): string {
  return i18n.t("autonomy.usage.summary", {
    tokens: totals.tokens.toLocaleString(),
    minutes: totals.minutes.toFixed(1),
    cost: formatUsageCost(totals.costUsd) ?? i18n.t("autonomy.usage.noPrice"),
  });
}
