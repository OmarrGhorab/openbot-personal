import { agentProviderName } from "@openbot/contracts/agent-providers";
import {
  type AgentProviderId,
  type AgentReasoningEffort,
  type PlanRavenTeamInput,
  RAVEN_STACK_LITE_TEMPLATE_ID,
  RAVEN_STACK_TEAM_TEMPLATE_ID,
  RAVEN_TEAM_BUILDER_ROLE_ID,
  RAVEN_TEAM_ROUND_CAP,
  type RavenTeamJob,
  type RavenTeamPlan,
  type RavenTeamPlanRole,
  type RavenTeamRoleRun,
  type RavenTeamTemplate,
  ravenTeamPlatformName,
} from "@openbot/contracts/ipc";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  Label,
  SlidingTabs,
  Switch,
  Textarea,
} from "@openbot/ui";
import { ArrowLeft, Play, Plus, TriangleAlert } from "@openbot/ui/icons";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { GitHubMark } from "../settings/brand-marks";
import { isTerminalJob, RavenTeamJobCard } from "./RavenTeamJobCard";
import { RavenTeamRoleIcon } from "./RavenTeamRoleIcon";
import { type RavenTeamModelChoice, RavenTeamRolePicker } from "./RavenTeamRolePicker";

export type { RavenTeamModelChoice } from "./RavenTeamRolePicker";

export interface RavenTeamPageProps {
  templates: RavenTeamTemplate[];
  jobs: RavenTeamJob[];
  models: RavenTeamModelChoice[];
  /** The text that the ticket box starts with, such as a ticket of the board. Read once. */
  initialBrief?: string | undefined;
  onPlan: (input: PlanRavenTeamInput) => Promise<RavenTeamPlan>;
  onStart: (input: PlanRavenTeamInput) => Promise<unknown>;
  onStop: (jobId: string) => Promise<unknown>;
  onResume: (jobId: string) => Promise<unknown>;
  onSetRoleModel: (input: { jobId: string; roleId: string; model: string }) => Promise<unknown>;
  /** Gives a role of a job Full access, from the job's access question. */
  onGiveRoleFullAccess: (input: { jobId: string; roleId: string }) => Promise<unknown>;
  /** Shows a Back button that returns to the page that opened the team. */
  onBack?: (() => void) | undefined;
  /**
   * The Autopilot tab. The page shows the tab only when the host gives its content, so a host without
   * Autopilot keeps Set up and Team jobs.
   */
  autopilot?: RavenTeamAutopilotTab | undefined;
  /** The tab that the page opens on. Set up by default; Team jobs when the Monitor opened a job. */
  initialTab?: RavenTeamTab | undefined;
}

export type RavenTeamTab = "setup" | "autopilot" | "jobs";

export interface RavenTeamAutopilotTab {
  /** True when Autopilot is on: the tab shows an On pill. */
  on: boolean;
  /** The line under the title while the tab is open. */
  intro: string;
  content: JSX.Element;
}

const isRavenTeamTab = (value: string): value is RavenTeamTab =>
  value === "setup" || value === "autopilot" || value === "jobs";

/** The ticket chip: a GitHub issue by its number, another ticket by its key. Null for plain text. */
const GITHUB_ISSUE_NUMBER = /github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)|(?:^|\s)#(\d+)\b/u;
const TICKET_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/u;

/** A line that names one GitHub issue: its URL, `owner/repo#12` or `#12`, with an optional title after it. */
const ISSUE_LINE = /^(?:https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+|(?:[\w.-]+\/[\w.-]+)?#\d+)(?:\s.*)?$/;

/**
 * The tickets of the ticket boxes, in order. A box that holds a list of GitHub issues, one per line, is
 * one ticket per line; any other box is one ticket. Empty boxes are left out.
 */
function ravenTeamTickets(boxes: readonly string[]): string[] {
  return boxes.flatMap((box) => {
    const lines = box
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (lines.length > 1 && lines.every((line) => ISSUE_LINE.test(line))) return lines;
    const ticket = box.trim();
    return ticket === "" ? [] : [ticket];
  });
}

/** One more ticket box. The id keeps the box when its text changes. */
interface TicketBox {
  id: number;
}

/**
 * The Raven Stack team page, in tabs: Set up, Autopilot and Team jobs with a count.
 *
 * Set up has two columns. The left column holds the ticket and the team: the presets and one row for
 * each role with its access, provider, model, effort and switch. The right column is the fixed "Your
 * team" panel: the role pipeline with models, the warnings, "Start team" and one line about FAIL rounds.
 * "Start team" stays in view without a scroll. A narrow window shows one column, and the start button
 * sticks to the bottom of the page. Team jobs holds one card for each job. The page holds the form only;
 * every change goes to the host through a prop.
 */
export function RavenTeamPage(props: RavenTeamPageProps) {
  const { t, errorMessage } = useText();
  // The full built-in template is first in the list, and it is the start choice.
  const [chosenTemplate, setChosenTemplate] = createSignal<string | null>(null);
  const template = () =>
    props.templates.find((candidate) => candidate.id === chosenTemplate()) ?? props.templates[0] ?? null;
  const templateId = () => template()?.id ?? "";
  /** The name of a template: a built-in one in the reader's language, a user copy by its own name. */
  const templateName = (candidate: RavenTeamTemplate) =>
    candidate.id === RAVEN_STACK_TEAM_TEMPLATE_ID
      ? t("agent.team.template.full")
      : candidate.id === RAVEN_STACK_LITE_TEMPLATE_ID
        ? t("agent.team.template.lite")
        : candidate.name;
  const [brief, setBrief] = createSignal(untrack(() => props.initialBrief ?? ""));
  // The ticket boxes after the first one, and the text of each. Each ticket starts its own job.
  const [moreBoxes, setMoreBoxes] = createSignal<TicketBox[]>([]);
  const [moreText, setMoreText] = createSignal<Record<number, string>>({});
  let nextBoxId = 1;
  const tickets = () => ravenTeamTickets([brief(), ...moreBoxes().map((box) => moreText()[box.id] ?? "")]);
  const addBox = () => {
    setMoreBoxes([...moreBoxes(), { id: nextBoxId }]);
    nextBoxId += 1;
  };
  const removeBox = (id: number) => {
    setMoreBoxes(moreBoxes().filter((box) => box.id !== id));
    setMoreText(Object.fromEntries(Object.entries(moreText()).filter(([key]) => Number(key) !== id)));
  };
  const [overrides, setOverrides] = createSignal<Record<string, string>>({});
  // Role id to the effort the user chose. The plan gives the model's default to a role not here.
  const [efforts, setEfforts] = createSignal<Record<string, AgentReasoningEffort>>({});
  // Read-only roles that the user gave Full access on the confirm card.
  const [fullAccess, setFullAccess] = createSignal<string[]>([]);
  const [plan, setPlan] = createSignal<RavenTeamPlan | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  /** Ids of the roles that this ticket leaves out. The Builder is never in the list. */
  const [skipped, setSkipped] = createSignal<string[]>([]);

  const request = (
    models: Record<string, string> = overrides(),
    access: string[] = fullAccess(),
    chosenEfforts: Record<string, AgentReasoningEffort> = efforts(),
    leftOut: string[] = skipped(),
  ): PlanRavenTeamInput => ({
    templateId: templateId(),
    // The roles are checked with the first ticket; each ticket is checked again when its job starts.
    brief: tickets()[0] ?? brief(),
    models,
    fullAccess: access,
    efforts: chosenEfforts,
    skippedRoles: leftOut,
  });
  const canStart = () => {
    const current = plan();
    return (
      current !== null &&
      current.unknownRoles.length === 0 &&
      current.unknownModels.length === 0 &&
      current.accessProblems.length === 0 &&
      current.roles.length > 0
    );
  };
  /** The access question: a read-only role whose provider cannot run Workspace only on this computer. */
  const accessText = (role: string, provider: AgentProviderId, platform: string | undefined) => {
    const os = platform ? ravenTeamPlatformName(platform) : null;
    const values = { role, provider: agentProviderName(provider) };
    return os
      ? t("agent.team.question.workspaceAccess", { ...values, os })
      : t("agent.team.question.workspaceAccessHere", values);
  };
  const roleLabel = (roleId: string) =>
    plan()?.roles.find((role) => role.roleId === roleId)?.label ??
    template()?.roles.find((role) => role.id === roleId)?.label ??
    roleId;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure, t("agent.team.check")));
    } finally {
      setBusy(false);
    }
  }

  /** Checks the plan. An empty ticket gets a translated message, not the host's raw validation text. */
  const check = (
    models?: Record<string, string>,
    access?: string[],
    chosenEfforts?: Record<string, AgentReasoningEffort>,
    leftOut?: string[],
  ) => {
    if (tickets().length === 0) {
      setError(t("agent.team.briefRequired"));
      return Promise.resolve();
    }
    return run(async () => setPlan(await props.onPlan(request(models, access, chosenEfforts, leftOut))));
  };

  /**
   * The team is checked as the ticket is written, so the roles show their models without a button. A
   * pause in typing, a new first ticket and another template check it again; an empty ticket clears it.
   */
  createEffect(
    () => ({ ticket: tickets()[0] ?? "", template: templateId() }),
    ({ ticket }) => {
      if (!ticket) {
        setPlan(null);
        return;
      }
      const timer = setTimeout(() => void check(), 450);
      return () => clearTimeout(timer);
    },
  );

  /**
   * Leaves a role out of this ticket, or puts it back. The Builder cannot be left out. The plan is checked
   * again with the new list: a signal write shows at the next flush, so the check gets the list itself.
   */
  const toggleSkip = (roleId: string, skip: boolean) => {
    const next = skip ? [...new Set([...skipped(), roleId])] : skipped().filter((id) => id !== roleId);
    setSkipped(next);
    const models = { ...overrides() };
    if (skip) delete models[roleId];
    setOverrides(models);
    void check(models, fullAccess(), efforts(), next);
  };

  /**
   * A model the user picks for a role. The plan is checked again with the new choice, so the question
   * clears or repeats. The check gets the choices itself: a signal write shows at the next flush, so
   * reading `overrides()` here would still give the old ones.
   */
  const pickModel = (roleId: string, model: string) => {
    const next = { ...overrides(), [roleId]: model };
    setOverrides(next);
    void check(next);
  };

  /** An effort the user picks for a role. The plan is checked again, as for a model. */
  const pickEffort = (roleId: string, effort: AgentReasoningEffort) => {
    const next = { ...efforts(), [roleId]: effort };
    setEfforts(next);
    void check(overrides(), fullAccess(), next);
  };

  /**
   * Turns an optional role on or off. On, it takes the Builder's model, which the user can change; an
   * optional role starts only when it has a model. Off, the choice goes; a role that the ticket text
   * names stays on.
   */
  const toggleOptional = (roleId: string, on: boolean) => {
    const next = { ...overrides() };
    if (on) {
      const builder = plan()?.roles.find((role) => role.roleId === "builder");
      const model = builder?.model ?? props.models[0]?.id;
      if (!model) return;
      next[roleId] = model;
    } else {
      delete next[roleId];
    }
    setOverrides(next);
    void check(next);
  };

  /**
   * Another template: its roles replace the list. The choices for the old roles go, and a ticket that
   * is written is checked again with the new roles.
   */
  const pickTemplate = (next: RavenTeamTemplate | null) => {
    if (!next || next.id === templateId()) return;
    setChosenTemplate(next.id);
    setOverrides({});
    setEfforts({});
    setFullAccess([]);
    setSkipped([]);
    setPlan(null);
    setError(null);
  };

  /** The one-click answer to the access question on the confirm card. The plan is checked again. */
  const giveFullAccess = (roleId: string) => {
    const next = [...new Set([...fullAccess(), roleId])];
    setFullAccess(next);
    void check(overrides(), next);
  };

  const accessBadge = (role: RavenTeamPlanRole) =>
    role.access === "write"
      ? t("agent.team.access.write")
      : role.fullAccess
        ? t("agent.team.access.readOnlyFull")
        : t("agent.team.access.readOnly");

  /**
   * The start input of one ticket. The first ticket takes the choices as they are. Another ticket keeps
   * the models it names with `Role: model`: its own plan says which roles it names, and the choices for
   * those roles are left out, so the ticket's model wins for that job only.
   */
  const ticketRequest = async (ticket: string, index: number): Promise<PlanRavenTeamInput> => {
    const shared = request();
    if (index === 0) return { ...shared, brief: ticket };
    const own = await props.onPlan({ templateId: templateId(), brief: ticket });
    const named = new Set(own.roles.filter((role) => role.named).map((role) => role.roleId));
    const models = Object.fromEntries(Object.entries(shared.models ?? {}).filter(([roleId]) => !named.has(roleId)));
    const chosenEfforts = Object.fromEntries(
      Object.entries(shared.efforts ?? {}).filter(([roleId]) => !named.has(roleId)),
    );
    return {
      ...shared,
      brief: ticket,
      models,
      efforts: chosenEfforts,
      fullAccess: (shared.fullAccess ?? []).filter((roleId) => !named.has(roleId)),
    };
  };

  /** Starts one team job per ticket, in order. A job over the limit waits in the host's queue. */
  const start = () =>
    run(async () => {
      for (const [index, ticket] of tickets().entries()) {
        await props.onStart(await ticketRequest(ticket, index));
      }
      setPlan(null);
      setBrief("");
      setMoreBoxes([]);
      setMoreText({});
      setOverrides({});
      setEfforts({});
      setFullAccess([]);
      setSkipped([]);
    });

  /** What the role does, in one line. A role of a copied template has no line. */
  const roleHint = (role: { id: string; optional: boolean }): string | null => {
    if (role.optional) return t("agent.team.optionalRole");
    switch (role.id) {
      case "architect":
        return t("agent.team.role.hint.architect");
      case "builder":
        return t("agent.team.role.hint.builder");
      case "reviewer":
        return t("agent.team.role.hint.reviewer");
      case "quality":
        return t("agent.team.role.hint.quality");
      default:
        return null;
    }
  };
  /** What a left-out role costs the job: a planning role hands its work to the Builder, a checking role leaves a gap. */
  const skipNote = (role: { skills: string[] }): string =>
    role.skills.includes("verify") || role.skills.includes("quality")
      ? t("agent.team.role.skip.checks")
      : t("agent.team.role.skip.plans");
  const templateHint = (candidate: RavenTeamTemplate): string =>
    candidate.id === RAVEN_STACK_TEAM_TEMPLATE_ID
      ? t("agent.team.template.fullHint")
      : candidate.id === RAVEN_STACK_LITE_TEMPLATE_ID
        ? t("agent.team.template.liteHint")
        : candidate.roles.map((role) => role.label).join(" · ");
  /** True when the plan has no role that checks the Builder: the job then ends at the Builder's commit. */
  const nobodyChecks = () => {
    const current = plan();
    return (
      current !== null &&
      current.roles.length > 0 &&
      !current.roles.some((role) => role.skills.includes("verify") || role.skills.includes("quality"))
    );
  };

  const [tab, setTab] = createSignal<RavenTeamTab>(
    untrack(() => (props.initialTab === "autopilot" && !props.autopilot ? "setup" : (props.initialTab ?? "setup"))),
  );
  /** Jobs that are not over: the count on the Team jobs tab. */
  const openJobs = () => props.jobs.filter((job) => !isTerminalJob(job)).length;

  /** The ticket chip under the ticket box: how many tickets, and what the first one is. */
  const ticketChip = () => {
    const all = tickets();
    if (all.length === 0) return null;
    const first = all[0] ?? "";
    const issue = GITHUB_ISSUE_NUMBER.exec(first);
    const key = TICKET_KEY.exec(first);
    const count = t("agent.team.detected.tickets", { count: all.length });
    const source = issue
      ? t("agent.team.detected.github", { number: issue[1] ?? issue[2] ?? "" })
      : key?.[1]
        ? t("agent.team.detected.key", { key: key[1] })
        : null;
    return { text: source ? `${count} · ${source}` : count, github: issue !== null };
  };
  /** The roles whose model the ticket names: the ticket wins for those roles. */
  const modelsInTicket = () =>
    (plan()?.roles ?? [])
      .filter((role) => role.named && !Object.hasOwn(overrides(), role.roleId))
      .map((role) => role.label);

  /** The one line of a role in the "Your team" panel. */
  const roleShort = (roleId: string): string | null => {
    switch (roleId) {
      case "architect":
        return t("agent.team.role.short.architect");
      case "builder":
        return t("agent.team.role.short.builder");
      case "reviewer":
        return t("agent.team.role.short.reviewer");
      case "quality":
        return t("agent.team.role.short.quality");
      case "editor":
        return t("agent.team.role.short.editor");
      default:
        return null;
    }
  };
  const modelName = (model: string) => props.models.find((choice) => choice.id === model)?.name ?? model;
  const jobTemplateName = (job: RavenTeamJob) => {
    const candidate = props.templates.find((item) => item.id === job.templateId);
    return candidate ? templateName(candidate) : "";
  };
  const jobAccessText = (role: RavenTeamRoleRun, platform: string | undefined) =>
    accessText(role.label, role.provider, platform);

  const intro = () => (tab() === "autopilot" && props.autopilot ? props.autopilot.intro : t("agent.team.intro"));

  return (
    <div class="raven-team-page">
      <SlidingTabs.Root value={tab()} onChange={(value: string) => isRavenTeamTab(value) && setTab(value)}>
        <header class="raven-team-header">
          <div class="raven-team-header-text">
            <Show when={props.onBack}>
              {(onBack) => (
                <Button variant="ghost" size="sm" class="raven-team-back" onClick={() => onBack()()}>
                  <ArrowLeft aria-hidden="true" />
                  {t("agent.team.back")}
                </Button>
              )}
            </Show>
            <h2 class="raven-team-title">{t("agent.team.title")}</h2>
            <p class="raven-team-intro">{intro()}</p>
          </div>
          <SlidingTabs.List class="raven-team-tabs" aria-label={t("agent.team.tabs")}>
            <SlidingTabs.Trigger value="setup">{t("agent.team.tab.setup")}</SlidingTabs.Trigger>
            <Show when={props.autopilot}>
              {(autopilot) => (
                <SlidingTabs.Trigger value="autopilot">
                  {t("agent.team.tab.autopilot")}
                  <Show when={autopilot().on}>
                    <Badge variant="success-light" class="raven-team-tab-pill">
                      {t("agent.team.tab.on")}
                    </Badge>
                  </Show>
                </SlidingTabs.Trigger>
              )}
            </Show>
            <SlidingTabs.Trigger value="jobs">
              {t("agent.team.tab.jobs")}
              <Show when={props.jobs.length > 0}>
                <span class="raven-team-tab-count" aria-hidden="true">
                  {openJobs()}
                </span>
                <span class="sr-only">{t("agent.team.tab.openJobs", { count: openJobs() })}</span>
              </Show>
            </SlidingTabs.Trigger>
          </SlidingTabs.List>
        </header>
      </SlidingTabs.Root>

      <Show when={tab() === "setup"}>
        <div class="raven-team-setup">
          <div class="raven-team-setup-main">
            <section class="raven-team-panel" aria-labelledby="raven-team-ticket-title">
              <header class="raven-team-panel-head">
                <span class="raven-team-step" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3 id="raven-team-ticket-title" class="raven-team-subtitle">
                    {t("agent.team.ticket")}
                  </h3>
                  <p class="raven-team-hint">{t("agent.team.step.ticketHint")}</p>
                </div>
              </header>
              <Textarea
                id="raven-team-ticket"
                class="raven-team-ticket"
                rows={3}
                aria-label={t("agent.team.ticket")}
                value={brief()}
                placeholder={t("agent.team.ticketPlaceholder")}
                onInput={(event) => setBrief(event.currentTarget.value)}
              />
              <For each={moreBoxes()}>
                {(box, index) => {
                  const number = () => index() + 2;
                  const id = `raven-team-ticket-${box.id + 1}`;
                  return (
                    <div class="raven-team-more-ticket">
                      <div class="raven-team-more-ticket-head">
                        <Label class="raven-team-label" for={id}>
                          {t("agent.team.ticketNumber", { number: number() })}
                        </Label>
                        <Button variant="ghost" size="sm" disabled={busy()} onClick={() => removeBox(box.id)}>
                          {t("agent.team.removeTicket", { number: number() })}
                        </Button>
                      </div>
                      <Textarea
                        id={id}
                        class="raven-team-ticket"
                        rows={3}
                        value={moreText()[box.id] ?? ""}
                        placeholder={t("agent.team.ticketPlaceholder")}
                        onInput={(event) => setMoreText({ ...moreText(), [box.id]: event.currentTarget.value })}
                      />
                    </div>
                  );
                }}
              </For>
              <div class="raven-team-ticket-chips">
                <Show when={ticketChip()}>
                  {(chip) => (
                    <span class="raven-team-chip">
                      <Show when={chip().github}>
                        <GitHubMark class="raven-team-chip-icon" />
                      </Show>
                      {chip().text}
                    </span>
                  )}
                </Show>
                <Show when={modelsInTicket().length > 0}>
                  <span class="raven-team-chip raven-team-chip-muted">
                    {t("agent.team.detected.modelInTicket", { roles: modelsInTicket().join(", ") })}
                  </span>
                </Show>
                <Button variant="ghost" size="sm" class="raven-team-add-ticket" disabled={busy()} onClick={addBox}>
                  <Plus aria-hidden="true" />
                  {t("agent.team.addTicket")}
                </Button>
              </div>
              <p class="raven-team-hint raven-team-hint-small">{t("agent.team.ticketsHint")}</p>
            </section>

            <section class="raven-team-panel" aria-labelledby="raven-team-roles-title">
              <header class="raven-team-panel-head">
                <span class="raven-team-step" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3 id="raven-team-roles-title" class="raven-team-subtitle">
                    {t("agent.team.step.team")}
                  </h3>
                  <p class="raven-team-hint">{t("agent.team.step.teamHint")}</p>
                </div>
              </header>
              <div class="raven-team-presets">
                <For each={props.templates}>
                  {(candidate) => (
                    <Button
                      variant="outline"
                      class="raven-team-preset"
                      aria-pressed={candidate.id === templateId() ? "true" : "false"}
                      disabled={busy()}
                      onClick={() => pickTemplate(candidate)}
                    >
                      <span class="raven-team-preset-name">
                        {templateName(candidate)}
                        <Show when={candidate.id === templateId()}>
                          <Badge variant="primary-outline" class="raven-team-preset-selected">
                            <span class="raven-team-dot" aria-hidden="true" />
                            {t("agent.team.preset.selected")}
                          </Badge>
                        </Show>
                      </span>
                      <span class="raven-team-preset-hint">{templateHint(candidate)}</span>
                    </Button>
                  )}
                </For>
              </div>
              <ul class="raven-team-roles">
                <For each={template()?.roles ?? []}>
                  {(definition) => {
                    const planned = () => plan()?.roles.find((role) => role.roleId === definition.id);
                    const isBuilder = () => definition.id === RAVEN_TEAM_BUILDER_ROLE_ID;
                    const accessLabel = () => {
                      const role = planned();
                      if (role) return accessBadge(role);
                      return definition.access === "write"
                        ? t("agent.team.access.write")
                        : t("agent.team.access.readOnly");
                    };
                    const off = () =>
                      definition.optional ? planned() === undefined : skipped().includes(definition.id);
                    return (
                      <li class="raven-team-role-card" data-off={off() ? "" : undefined}>
                        <RavenTeamRoleIcon roleId={definition.id} />
                        <div class="raven-team-role-info">
                          <div class="raven-team-role-title">
                            <span class="raven-team-role-label">{definition.label}</span>
                            <Show
                              when={definition.optional && off()}
                              fallback={
                                <Badge
                                  variant={definition.access === "write" ? "primary-outline" : "outline"}
                                  class="raven-team-role-access"
                                >
                                  <Show when={definition.access === "write"}>
                                    <span class="raven-team-dot" aria-hidden="true" />
                                  </Show>
                                  {accessLabel()}
                                </Badge>
                              }
                            >
                              <Badge variant="outline" class="raven-team-role-access">
                                {t("agent.team.role.optional")}
                              </Badge>
                            </Show>
                          </div>
                          <Show
                            when={!off() || definition.optional}
                            fallback={<p class="raven-team-role-skipnote">{skipNote(definition)}</p>}
                          >
                            <Show when={roleHint(definition)}>
                              {(hint) => <p class="raven-team-role-hint">{hint()}</p>}
                            </Show>
                          </Show>
                        </div>
                        <div class="raven-team-role-controls">
                          <Show when={!off()}>
                            <Show
                              when={planned()}
                              fallback={<p class="raven-team-role-hint">{t("agent.team.writeFirst")}</p>}
                            >
                              {(role) => (
                                <RavenTeamRolePicker
                                  role={role().label}
                                  models={props.models}
                                  model={role().model}
                                  effort={role().reasoningEffort}
                                  disabled={busy()}
                                  onModel={(model) => pickModel(role().roleId, model)}
                                  onEffort={(effort) => pickEffort(role().roleId, effort)}
                                />
                              )}
                            </Show>
                          </Show>
                          <Show
                            when={!isBuilder()}
                            fallback={<span class="raven-team-role-locked">{t("agent.team.role.alwaysOn")}</span>}
                          >
                            <Switch
                              class="raven-team-role-switch"
                              checked={!off()}
                              disabled={busy()}
                              aria-label={definition.label}
                              onChange={(on: boolean) =>
                                definition.optional ? toggleOptional(definition.id, on) : toggleSkip(definition.id, !on)
                              }
                            />
                          </Show>
                        </div>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </section>
          </div>

          <aside class="raven-team-yourteam" aria-labelledby="raven-team-yourteam-title">
            <header class="raven-team-yourteam-head">
              <h3 id="raven-team-yourteam-title" class="raven-team-eyebrow">
                {t("agent.team.yourTeam")}
              </h3>
              <Show when={plan()}>
                {(current) => (
                  <span class="raven-team-yourteam-count">
                    {t("agent.team.yourTeam.roles", { count: current().roles.length })} ·{" "}
                    {t("agent.team.yourTeam.jobs", { count: Math.max(tickets().length, 1) })}
                  </span>
                )}
              </Show>
            </header>
            <Show
              when={plan()}
              fallback={
                <p class="raven-team-hint" aria-live="polite">
                  {busy() ? t("agent.team.checking") : t("agent.team.writeFirst")}
                </p>
              }
            >
              {(current) => (
                <>
                  <p class="sr-only" aria-live="polite">
                    {t("agent.team.summary", {
                      count: current().roles.length,
                      roles: current()
                        .roles.map((role) => role.label)
                        .join(" · "),
                    })}
                  </p>
                  <ol class="raven-team-lineup">
                    <For each={current().roles}>
                      {(role) => (
                        <li class="raven-team-lineup-role">
                          <RavenTeamRoleIcon roleId={role.roleId} />
                          <div class="raven-team-lineup-text">
                            <span class="raven-team-role-label">{role.label}</span>
                            <Show when={roleShort(role.roleId)}>
                              {(line) => <span class="raven-team-lineup-hint">{line()}</span>}
                            </Show>
                            <span class="raven-team-lineup-model">{modelName(role.model)}</span>
                          </div>
                        </li>
                      )}
                    </For>
                  </ol>
                  <div class="raven-team-warnings">
                    <Show when={nobodyChecks()}>
                      <Alert tone="warning">
                        <AlertIcon>
                          <TriangleAlert />
                        </AlertIcon>
                        <AlertContent>
                          <AlertDescription>{t("agent.team.warning.noCheck")}</AlertDescription>
                        </AlertContent>
                      </Alert>
                    </Show>
                    <For each={current().unknownModels}>
                      {(unknown) => (
                        <Alert tone="warning" role="alert">
                          <AlertContent>
                            <AlertDescription>
                              {unknown.roleId === "fallback"
                                ? t("agent.team.question.unknownModel", { model: unknown.model, role: "fallback" })
                                : unknown.model
                                  ? t("agent.team.question.unknownModel", {
                                      model: unknown.model,
                                      role: roleLabel(unknown.roleId),
                                    })
                                  : t("agent.team.question.noModel", { role: roleLabel(unknown.roleId) })}
                            </AlertDescription>
                          </AlertContent>
                        </Alert>
                      )}
                    </For>
                    <For each={current().accessProblems}>
                      {(problem) => (
                        <Alert tone="danger" role="alert" class="raven-team-access-banner">
                          <AlertIcon>
                            <TriangleAlert />
                          </AlertIcon>
                          <AlertContent>
                            <AlertTitle>{t("agent.team.access.title", { role: roleLabel(problem.roleId) })}</AlertTitle>
                            <AlertDescription>
                              {accessText(roleLabel(problem.roleId), problem.provider, problem.platform)}
                            </AlertDescription>
                          </AlertContent>
                          <AlertActions>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy()}
                              onClick={() => giveFullAccess(problem.roleId)}
                            >
                              {t("agent.team.access.giveFull", { role: roleLabel(problem.roleId) })}
                            </Button>
                          </AlertActions>
                        </Alert>
                      )}
                    </For>
                    <For each={current().unknownRoles}>
                      {(roleId) => (
                        <Alert tone="warning" role="alert">
                          <AlertContent>
                            <AlertDescription>
                              {t("agent.team.question.unknownRole", { role: roleId })}
                            </AlertDescription>
                          </AlertContent>
                        </Alert>
                      )}
                    </For>
                    <For each={current().warnings}>
                      {(warning) => (
                        <Alert tone="warning">
                          <AlertIcon>
                            <TriangleAlert />
                          </AlertIcon>
                          <AlertContent>
                            <AlertDescription>
                              {t("agent.team.warning.sameModel", {
                                role: roleLabel(warning.roleId),
                                model: modelName(warning.model),
                              })}
                            </AlertDescription>
                          </AlertContent>
                        </Alert>
                      )}
                    </For>
                  </div>
                </>
              )}
            </Show>
            <Show when={error()}>
              {(message) => (
                <Alert tone="danger" role="alert">
                  <AlertContent>
                    <AlertDescription>{message()}</AlertDescription>
                  </AlertContent>
                </Alert>
              )}
            </Show>
          </aside>

          <div class="raven-team-start">
            <Button class="raven-team-start-button" disabled={busy() || !canStart()} onClick={() => void start()}>
              <Play aria-hidden="true" />
              {tickets().length > 1 ? t("agent.team.startJobs", { count: tickets().length }) : t("agent.team.start")}
            </Button>
            <p class="raven-team-hint raven-team-hint-small">
              {t("agent.team.roundsNote", { cap: RAVEN_TEAM_ROUND_CAP })}
            </p>
          </div>
        </div>
      </Show>

      <Show when={tab() === "autopilot" && props.autopilot}>
        {(autopilot) => <div class="raven-team-tab-body">{autopilot().content}</div>}
      </Show>

      <Show when={tab() === "jobs"}>
        <section class="raven-team-tab-body raven-team-jobs" aria-label={t("agent.team.jobs")}>
          <Show when={error()}>
            {(message) => (
              <Alert tone="danger" role="alert">
                <AlertContent>
                  <AlertDescription>{message()}</AlertDescription>
                </AlertContent>
              </Alert>
            )}
          </Show>
          <Show when={props.jobs.length > 0} fallback={<p class="raven-team-empty">{t("agent.team.noJobs")}</p>}>
            <For each={props.jobs}>
              {(job) => (
                <RavenTeamJobCard
                  job={job}
                  templateName={jobTemplateName(job)}
                  models={props.models}
                  busy={busy()}
                  accessText={jobAccessText}
                  run={(action) => void run(action)}
                  onStop={props.onStop}
                  onResume={props.onResume}
                  onSetRoleModel={props.onSetRoleModel}
                  onGiveRoleFullAccess={props.onGiveRoleFullAccess}
                />
              )}
            </For>
          </Show>
        </section>
      </Show>
    </div>
  );
}
