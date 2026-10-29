import { agentProviderName } from "@openbot/contracts/agent-providers";
import {
  type AgentProviderId,
  type AgentReasoningEffort,
  type PlanRavenTeamInput,
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
  Badge,
  Button,
  Label,
  SwitchField,
  Textarea,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";
import { RAVEN_TEAM_EFFORT_LABEL, type RavenTeamModelChoice, RavenTeamRolePicker } from "./RavenTeamRolePicker";

export type { RavenTeamModelChoice } from "./RavenTeamRolePicker";

export interface RavenTeamPageProps {
  templates: RavenTeamTemplate[];
  jobs: RavenTeamJob[];
  models: RavenTeamModelChoice[];
  onPlan: (input: PlanRavenTeamInput) => Promise<RavenTeamPlan>;
  onStart: (input: PlanRavenTeamInput) => Promise<unknown>;
  onStop: (jobId: string) => Promise<unknown>;
  onResume: (jobId: string) => Promise<unknown>;
  onSetRoleModel: (input: { jobId: string; roleId: string; model: string }) => Promise<unknown>;
  /** Gives a role of a job Full access, from the job's access question. */
  onGiveRoleFullAccess: (input: { jobId: string; roleId: string }) => Promise<unknown>;
  /** Shows a Back button that returns to the page that opened the team. */
  onBack?: (() => void) | undefined;
}

const JOB_STATE_KEY = {
  running: "agent.team.job.state.running",
  stopped: "agent.team.job.state.stopped",
  "waiting-user": "agent.team.job.state.waitingUser",
  done: "agent.team.job.state.done",
  "not-done": "agent.team.job.state.notDone",
} as const;

const JOB_STATE_BADGE = {
  running: "primary-light",
  stopped: "secondary",
  "waiting-user": "destructive-light",
  done: "default",
  "not-done": "destructive",
} as const;

const ROLE_STATE_KEY = {
  waiting: "agent.team.role.state.waiting",
  working: "agent.team.role.state.working",
  reported: "agent.team.role.state.reported",
  passed: "agent.team.role.state.passed",
  failed: "agent.team.role.state.failed",
  blocked: "agent.team.role.state.blocked",
  stopped: "agent.team.role.state.stopped",
} as const;

const shortCommit = (commit: string | null) => (commit ? commit.slice(0, 7) : "");

/** The first line of a ticket, which names the job in the list. */
const firstLine = (text: string) => text.split("\n")[0] ?? "";

const isTerminal = (job: RavenTeamJob) => job.state === "done" || job.state === "not-done";

/**
 * The Raven Stack team page in two columns. The left column holds the ticket, "Check the team" and the
 * team jobs. The right column holds the roles with their provider, model and effort, the warnings and
 * "Start team". Each column scrolls on its own; a narrow window shows one column. The page holds the
 * form only; every change goes to the host through a prop.
 */
export function RavenTeamPage(props: RavenTeamPageProps) {
  const { t, errorMessage } = useText();
  // The built-in template is first in the list.
  const templateId = () => props.templates[0]?.id ?? "";
  const template = () => props.templates.find((candidate) => candidate.id === templateId()) ?? null;
  const [brief, setBrief] = createSignal("");
  const [overrides, setOverrides] = createSignal<Record<string, string>>({});
  // Role id to the effort the user chose. The plan gives the model's default to a role not here.
  const [efforts, setEfforts] = createSignal<Record<string, AgentReasoningEffort>>({});
  // Read-only roles that the user gave Full access on the confirm card.
  const [fullAccess, setFullAccess] = createSignal<string[]>([]);
  const [plan, setPlan] = createSignal<RavenTeamPlan | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const request = (
    models: Record<string, string> = overrides(),
    access: string[] = fullAccess(),
    chosenEfforts: Record<string, AgentReasoningEffort> = efforts(),
  ): PlanRavenTeamInput => ({
    templateId: templateId(),
    brief: brief(),
    models,
    fullAccess: access,
    efforts: chosenEfforts,
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
  /** Optional roles of the template, such as the Editor. Each one is a row with a switch. */
  const optionalRoles = () => template()?.roles.filter((role) => role.optional) ?? [];

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
  ) => {
    if (brief().trim() === "") {
      setError(t("agent.team.briefRequired"));
      return Promise.resolve();
    }
    return run(async () => setPlan(await props.onPlan(request(models, access, chosenEfforts))));
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

  /** The one-click answer to the access question on the confirm card. The plan is checked again. */
  const giveFullAccess = (roleId: string) => {
    const next = [...new Set([...fullAccess(), roleId])];
    setFullAccess(next);
    void check(overrides(), next);
  };

  /** The provider, model and effort of a planned role, as the confirm card names them. */
  const choiceText = (role: RavenTeamPlanRole) => {
    const model = props.models.find((candidate) => candidate.id === role.model);
    return [
      model?.providerName ?? role.provider,
      model?.name ?? role.model,
      role.reasoningEffort ? t(RAVEN_TEAM_EFFORT_LABEL[role.reasoningEffort]) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const accessBadge = (role: RavenTeamPlanRole) =>
    role.access === "write"
      ? t("agent.team.access.write")
      : role.fullAccess
        ? t("agent.team.access.readOnlyFull")
        : t("agent.team.access.readOnly");

  const start = () =>
    run(async () => {
      await props.onStart(request());
      setPlan(null);
      setBrief("");
      setOverrides({});
      setEfforts({});
      setFullAccess([]);
    });

  function JobRoleRow(rowProps: { job: RavenTeamJob; role: RavenTeamRoleRun }) {
    return (
      <li class="raven-team-job-role">
        <div class="raven-team-role-head">
          <span class="raven-team-role-label">{rowProps.role.label}</span>
          <span class="raven-team-role-state">{t(ROLE_STATE_KEY[rowProps.role.state])}</span>
          <Show when={rowProps.role.verdict}>
            {(verdict) => <span class="raven-team-role-verdict">{verdict()}</span>}
          </Show>
          <Show when={rowProps.role.score !== null}>
            <span class="raven-team-role-score">{t("agent.team.role.score", { score: rowProps.role.score ?? 0 })}</span>
          </Show>
          <Show when={rowProps.role.commit}>
            {(commit) => <code class="raven-team-role-commit">{shortCommit(commit())}</code>}
          </Show>
        </div>
        {/* A role of a running job can move to another model from its next turn. */}
        <Show when={!isTerminal(rowProps.job)}>
          <RavenTeamRolePicker
            role={rowProps.role.label}
            models={props.models}
            model={rowProps.role.model}
            disabled={busy()}
            onModel={(model) =>
              void run(() => props.onSetRoleModel({ jobId: rowProps.job.id, roleId: rowProps.role.roleId, model }))
            }
          />
        </Show>
      </li>
    );
  }

  function JobCard(cardProps: { job: RavenTeamJob }) {
    const job = () => cardProps.job;
    return (
      <article class="raven-team-card raven-team-job" aria-label={firstLine(job().brief)}>
        <div class="raven-team-job-head">
          <span class="raven-team-job-brief">{firstLine(job().brief)}</span>
          <Badge variant={JOB_STATE_BADGE[job().state]} class="raven-team-job-state">
            {t(JOB_STATE_KEY[job().state])}
          </Badge>
        </div>
        <div class="raven-team-job-meta">
          <Show when={job().headCommit}>
            {(commit) => (
              <code class="raven-team-role-commit">{t("agent.team.job.head", { commit: shortCommit(commit()) })}</code>
            )}
          </Show>
          <span class="raven-team-job-rounds">
            {t("agent.team.job.rounds", { count: job().fixRounds, cap: job().roundCap })}
          </span>
        </div>
        <Show when={job().question}>
          {(question) => {
            const accessRole = () =>
              question().kind === "workspace-access"
                ? job().roles.find((role) => role.roleId === question().roleId)
                : undefined;
            return (
              <Show
                when={accessRole()}
                fallback={
                  <Alert tone="warning">
                    <AlertContent>
                      <AlertDescription>
                        {question().kind === "fallback-model"
                          ? t("agent.team.question.fallback")
                          : question().kind === "no-report"
                            ? t("agent.team.question.noReport")
                            : t("agent.team.question.blocked")}
                      </AlertDescription>
                    </AlertContent>
                  </Alert>
                }
              >
                {(role) => (
                  <Alert tone="danger" role="alert" class="raven-team-access-question">
                    <AlertContent>
                      <AlertDescription>
                        {accessText(role().label, role().provider, question().platform)}
                      </AlertDescription>
                    </AlertContent>
                    <AlertActions>
                      <Button
                        size="sm"
                        disabled={busy()}
                        onClick={() =>
                          void run(() => props.onGiveRoleFullAccess({ jobId: job().id, roleId: role().roleId }))
                        }
                      >
                        {t("agent.team.access.giveFull", { role: role().label })}
                      </Button>
                    </AlertActions>
                  </Alert>
                )}
              </Show>
            );
          }}
        </Show>
        <ul class="raven-team-job-roles">
          <For each={job().roles}>{(role) => <JobRoleRow job={job()} role={role} />}</For>
        </ul>
        <div class="raven-team-actions">
          <Show when={job().state === "stopped"}>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy()}
              onClick={() => void run(() => props.onResume(job().id))}
            >
              {t("agent.team.job.resume")}
            </Button>
          </Show>
          <Show when={job().state === "running" || job().state === "waiting-user"}>
            <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void run(() => props.onStop(job().id))}>
              {t("agent.team.job.stop")}
            </Button>
          </Show>
        </div>
      </article>
    );
  }

  return (
    <div class="raven-team-page">
      <header class="raven-team-header">
        <Show when={props.onBack}>
          {(onBack) => (
            <Button variant="ghost" size="sm" onClick={() => onBack()()}>
              {t("agent.team.back")}
            </Button>
          )}
        </Show>
        <h2 class="raven-team-title">{t("agent.team.title")}</h2>
        <p class="raven-team-intro">{t("agent.team.intro")}</p>
      </header>

      <div class="raven-team-columns">
        <div class="raven-team-column raven-team-column-ticket">
          <section class="raven-team-form" aria-labelledby="raven-team-ticket-label">
            <Label class="raven-team-label" id="raven-team-ticket-label" for="raven-team-ticket">
              {t("agent.team.ticket")}
            </Label>
            <Textarea
              id="raven-team-ticket"
              class="raven-team-ticket"
              rows={6}
              value={brief()}
              placeholder={t("agent.team.ticketPlaceholder")}
              onInput={(event) => setBrief(event.currentTarget.value)}
            />
            <div class="raven-team-actions">
              <Button variant="secondary" disabled={busy()} onClick={() => void check()}>
                {t("agent.team.check")}
              </Button>
            </div>
            <Show when={error()}>
              {(message) => (
                <Alert tone="danger" role="alert">
                  <AlertContent>
                    <AlertDescription>{message()}</AlertDescription>
                  </AlertContent>
                </Alert>
              )}
            </Show>
          </section>

          <section class="raven-team-jobs" aria-labelledby="raven-team-jobs-title">
            <h3 id="raven-team-jobs-title" class="raven-team-subtitle">
              {t("agent.team.jobs")}
            </h3>
            <Show when={props.jobs.length > 0} fallback={<p class="raven-team-empty">{t("agent.team.noJobs")}</p>}>
              <For each={props.jobs}>{(job) => <JobCard job={job} />}</For>
            </Show>
          </section>
        </div>

        <section class="raven-team-column raven-team-column-roles" aria-labelledby="raven-team-roles-title">
          <h3 id="raven-team-roles-title" class="raven-team-subtitle">
            {t("agent.team.roles")}
          </h3>
          <Show
            when={plan()}
            fallback={
              <>
                <ul class="raven-team-plan">
                  <For each={template()?.roles.filter((role) => !role.optional) ?? []}>
                    {(role) => (
                      <li class="raven-team-card raven-team-role">
                        <div class="raven-team-role-head">
                          <span class="raven-team-role-label">{role.label}</span>
                          <Badge variant="outline">
                            {role.access === "write" ? t("agent.team.access.write") : t("agent.team.access.readOnly")}
                          </Badge>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
                <p class="raven-team-empty">{t("agent.team.rolesHint")}</p>
              </>
            }
          >
            {(current) => (
              <>
                <ul class="raven-team-plan">
                  <For each={current().roles.filter((role) => !role.optional)}>
                    {(role) => (
                      <li class="raven-team-card raven-team-role">
                        <div class="raven-team-role-head">
                          <span class="raven-team-role-label">{role.label}</span>
                          <Badge variant="outline">{accessBadge(role)}</Badge>
                          <span class="raven-team-role-choice">{choiceText(role)}</span>
                        </div>
                        <RavenTeamRolePicker
                          role={role.label}
                          models={props.models}
                          model={role.model}
                          effort={role.reasoningEffort}
                          disabled={busy()}
                          onModel={(model) => pickModel(role.roleId, model)}
                          onEffort={(effort) => pickEffort(role.roleId, effort)}
                        />
                      </li>
                    )}
                  </For>
                  <For each={optionalRoles()}>
                    {(definition) => {
                      const planned = () => current().roles.find((role) => role.roleId === definition.id);
                      return (
                        <li class="raven-team-card raven-team-role raven-team-role-optional">
                          <SwitchField
                            class="raven-team-optional-switch"
                            checked={planned() !== undefined}
                            disabled={busy()}
                            onChange={(on: boolean) => toggleOptional(definition.id, on)}
                            label={definition.label}
                            description={t("agent.team.optionalRole")}
                          />
                          <Show when={planned()}>
                            {(role) => (
                              <>
                                <div class="raven-team-role-head">
                                  <Badge variant="outline">{accessBadge(role())}</Badge>
                                  <span class="raven-team-role-choice">{choiceText(role())}</span>
                                </div>
                                <RavenTeamRolePicker
                                  role={role().label}
                                  models={props.models}
                                  model={role().model}
                                  effort={role().reasoningEffort}
                                  disabled={busy()}
                                  onModel={(model) => pickModel(role().roleId, model)}
                                  onEffort={(effort) => pickEffort(role().roleId, effort)}
                                />
                              </>
                            )}
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ul>
                <div class="raven-team-warnings">
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
                      <Alert tone="danger" role="alert" class="raven-team-access-question">
                        <AlertContent>
                          <AlertDescription>
                            {accessText(roleLabel(problem.roleId), problem.provider, problem.platform)}
                          </AlertDescription>
                        </AlertContent>
                        <AlertActions>
                          <Button size="sm" disabled={busy()} onClick={() => giveFullAccess(problem.roleId)}>
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
                          <AlertDescription>{t("agent.team.question.unknownRole", { role: roleId })}</AlertDescription>
                        </AlertContent>
                      </Alert>
                    )}
                  </For>
                  <For each={current().warnings}>
                    {(warning) => (
                      <Alert tone="warning">
                        <AlertContent>
                          <AlertDescription>
                            {t("agent.team.warning.sameModel", {
                              role: roleLabel(warning.roleId),
                              model: warning.model,
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
          <div class="raven-team-actions raven-team-start">
            <Button disabled={busy() || !canStart()} onClick={() => void start()}>
              {t("agent.team.start")}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
