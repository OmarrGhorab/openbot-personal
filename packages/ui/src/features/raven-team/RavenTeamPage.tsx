import { agentProviderName } from "@openbot/contracts/agent-providers";
import {
  type AgentProviderId,
  type PlanRavenTeamInput,
  type RavenTeamJob,
  type RavenTeamPlan,
  type RavenTeamRoleRun,
  type RavenTeamTemplate,
  ravenTeamPlatformName,
} from "@openbot/contracts/ipc";
import { Alert, AlertActions, AlertContent, AlertDescription, Button, Label, Textarea } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";

/** A model a connected provider lists. The page shows the name and keeps the id. */
export interface RavenTeamModelChoice {
  id: string;
  name: string;
}

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

/**
 * The Raven Stack team page: the ticket, the confirm card with each role's model, the jobs, and the
 * role rows of each job. It holds the form only; every change goes to the host through a prop.
 */
export function RavenTeamPage(props: RavenTeamPageProps) {
  const { t, errorMessage } = useText();
  // The built-in template is first in the list. A template picker waits for the template editor.
  const templateId = () => props.templates[0]?.id ?? "";
  const [brief, setBrief] = createSignal("");
  const [overrides, setOverrides] = createSignal<Record<string, string>>({});
  // Read-only roles that the user gave Full access on the confirm card.
  const [fullAccess, setFullAccess] = createSignal<string[]>([]);
  const [plan, setPlan] = createSignal<RavenTeamPlan | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const request = (
    models: Record<string, string> = overrides(),
    access: string[] = fullAccess(),
  ): PlanRavenTeamInput => ({
    templateId: templateId(),
    brief: brief(),
    models,
    fullAccess: access,
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
  const roleLabel = (roleId: string) => plan()?.roles.find((role) => role.roleId === roleId)?.label ?? roleId;

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

  const check = (models?: Record<string, string>, access?: string[]) =>
    run(async () => setPlan(await props.onPlan(request(models, access))));

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

  /** The one-click answer to the access question on the confirm card. The plan is checked again. */
  const giveFullAccess = (roleId: string) => {
    const next = [...new Set([...fullAccess(), roleId])];
    setFullAccess(next);
    void check(overrides(), next);
  };

  const start = () =>
    run(async () => {
      await props.onStart(request());
      setPlan(null);
      setBrief("");
      setOverrides({});
      setFullAccess([]);
    });

  function ModelChoices(choice: { value: string; label: string; onPick: (model: string) => void }) {
    return (
      <fieldset class="raven-team-models" aria-label={choice.label}>
        <For each={props.models}>
          {(model) => (
            <Button
              size="sm"
              variant={model.id === choice.value ? "secondary" : "ghost"}
              aria-pressed={model.id === choice.value ? "true" : "false"}
              disabled={busy()}
              onClick={() => choice.onPick(model.id)}
            >
              {model.name}
            </Button>
          )}
        </For>
      </fieldset>
    );
  }

  function RoleRow(rowProps: { job: RavenTeamJob; role: RavenTeamRoleRun }) {
    return (
      <li class="raven-team-role">
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
        <ModelChoices
          value={rowProps.role.model}
          label={`${t("agent.team.model")}: ${rowProps.role.label}`}
          onPick={(model) =>
            void run(() => props.onSetRoleModel({ jobId: rowProps.job.id, roleId: rowProps.role.roleId, model }))
          }
        />
      </li>
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

      <section class="raven-team-form" aria-labelledby="raven-team-ticket-label">
        <Label class="raven-team-label" id="raven-team-ticket-label" for="raven-team-ticket">
          {t("agent.team.ticket")}
        </Label>
        <Textarea
          id="raven-team-ticket"
          rows={4}
          value={brief()}
          placeholder={t("agent.team.ticketPlaceholder")}
          onInput={(event) => setBrief(event.currentTarget.value)}
        />
        <div class="raven-team-actions">
          <Button variant="secondary" disabled={busy() || brief().trim() === ""} onClick={() => void check()}>
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

      <Show when={plan()}>
        {(current) => (
          <section class="raven-team-confirm" aria-labelledby="raven-team-confirm-title">
            <h3 id="raven-team-confirm-title" class="raven-team-subtitle">
              {t("agent.team.confirm")}
            </h3>
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
                <Alert tone="danger" role="alert">
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
                      {t("agent.team.warning.sameModel", { role: roleLabel(warning.roleId), model: warning.model })}
                    </AlertDescription>
                  </AlertContent>
                </Alert>
              )}
            </For>
            <ul class="raven-team-plan">
              <For each={current().roles}>
                {(role) => (
                  <li class="raven-team-role">
                    <div class="raven-team-role-head">
                      <span class="raven-team-role-label">{role.label}</span>
                      <span class="raven-team-role-state">
                        {role.access === "write"
                          ? t("agent.team.access.write")
                          : role.fullAccess
                            ? t("agent.team.access.readOnlyFull")
                            : t("agent.team.access.readOnly")}
                      </span>
                      <span class="raven-team-role-verdict">{role.model}</span>
                    </div>
                    <ModelChoices
                      value={role.model}
                      label={`${t("agent.team.model")}: ${role.label}`}
                      onPick={(model) => pickModel(role.roleId, model)}
                    />
                  </li>
                )}
              </For>
            </ul>
            <div class="raven-team-actions">
              <Button disabled={busy() || !canStart()} onClick={() => void start()}>
                {t("agent.team.start")}
              </Button>
            </div>
          </section>
        )}
      </Show>

      <section class="raven-team-jobs" aria-labelledby="raven-team-jobs-title">
        <h3 id="raven-team-jobs-title" class="raven-team-subtitle">
          {t("agent.team.jobs")}
        </h3>
        <Show when={props.jobs.length > 0} fallback={<p class="raven-team-empty">{t("agent.team.noJobs")}</p>}>
          <For each={props.jobs}>
            {(job) => (
              <article class="raven-team-job" aria-label={firstLine(job.brief)}>
                <div class="raven-team-job-head">
                  <span class="raven-team-job-state">{t(JOB_STATE_KEY[job.state])}</span>
                  <span class="raven-team-job-brief">{firstLine(job.brief)}</span>
                  <Show when={job.headCommit}>
                    {(commit) => (
                      <code class="raven-team-role-commit">
                        {t("agent.team.job.head", { commit: shortCommit(commit()) })}
                      </code>
                    )}
                  </Show>
                  <span class="raven-team-job-rounds">
                    {t("agent.team.job.rounds", { count: job.fixRounds, cap: job.roundCap })}
                  </span>
                </div>
                <Show when={job.question}>
                  {(question) => {
                    const accessRole = () =>
                      question().kind === "workspace-access"
                        ? job.roles.find((role) => role.roleId === question().roleId)
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
                          <Alert tone="danger" role="alert">
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
                                  void run(() => props.onGiveRoleFullAccess({ jobId: job.id, roleId: role().roleId }))
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
                <ul class="raven-team-roles">
                  <For each={job.roles}>{(role) => <RoleRow job={job} role={role} />}</For>
                </ul>
                <div class="raven-team-actions">
                  <Show when={job.state === "stopped"}>
                    <Button
                      variant="secondary"
                      disabled={busy()}
                      onClick={() => void run(() => props.onResume(job.id))}
                    >
                      {t("agent.team.job.resume")}
                    </Button>
                  </Show>
                  <Show when={job.state === "running" || job.state === "waiting-user"}>
                    <Button variant="ghost" disabled={busy()} onClick={() => void run(() => props.onStop(job.id))}>
                      {t("agent.team.job.stop")}
                    </Button>
                  </Show>
                </div>
              </article>
            )}
          </For>
        </Show>
      </section>
    </div>
  );
}
