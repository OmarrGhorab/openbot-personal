import type { RavenTeamJob, RavenTeamRoleRun } from "@openbot/contracts/ipc";
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIcon, AlertTitle, Badge, Button } from "@openbot/ui";
import { GitCommitHorizontal, Play, Square, TriangleAlert } from "@openbot/ui/icons";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { RavenTeamRoleIcon } from "./RavenTeamRoleIcon";
import { type RavenTeamModelChoice, RavenTeamRolePicker } from "./RavenTeamRolePicker";

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
  done: "success-light",
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

/** The first line of a ticket, which names the job in the list and in the Monitor. */
const firstLine = (text: string) => text.split("\n")[0] ?? "";

export const isTerminalJob = (job: RavenTeamJob) => job.state === "done" || job.state === "not-done";

const TICKET_KEY = /^(?:([A-Z][A-Z0-9]+-\d+)|#(\d+))\s*[:\-–—]?\s*(.*)$/u;
const GITHUB_ISSUE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)\s*(.*)$/u;

/**
 * The key and the title of a job's ticket: `OPS-151: Add dark mode` gives `OPS-151` and `Add dark mode`;
 * a GitHub issue link gives `#214` and the next line. A ticket with no key has a title only.
 */
function ravenTeamTicketName(brief: string): { key: string | null; title: string } {
  const lines = brief
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const first = lines[0] ?? "";
  const issue = GITHUB_ISSUE.exec(first);
  if (issue) return { key: `#${issue[1]}`, title: issue[2] || lines[1] || first };
  const keyed = TICKET_KEY.exec(first);
  if (keyed?.[3]) return { key: keyed[1] ?? `#${keyed[2]}`, title: keyed[3] };
  return { key: null, title: first };
}

interface RavenTeamJobCardProps {
  job: RavenTeamJob;
  /** The name of the job's template in the reader's language. */
  templateName: string;
  models: RavenTeamModelChoice[];
  busy: boolean;
  /** The access question of a role, in the reader's language. */
  accessText: (role: RavenTeamRoleRun, platform: string | undefined) => string;
  /** Runs an action of the card: the page shows its failure and holds the other buttons. */
  run: (action: () => Promise<unknown>) => void;
  onStop: (jobId: string) => Promise<unknown>;
  onResume: (jobId: string) => Promise<unknown>;
  onSetRoleModel: (input: { jobId: string; roleId: string; model: string }) => Promise<unknown>;
  onGiveRoleFullAccess: (input: { jobId: string; roleId: string }) => Promise<unknown>;
  /** More content at the end of the card, such as the merge line. */
  footer?: JSX.Element;
}

/**
 * One team job: its ticket and state, one step for each role with a bar coloured by the role's state,
 * the question that waits for the user, Stop or Resume, and the head commit. The models of a job that
 * is not over can change from the role's next turn.
 */
export function RavenTeamJobCard(props: RavenTeamJobCardProps) {
  const { t } = useText();
  const job = () => props.job;
  const name = () => ravenTeamTicketName(job().brief);
  const [modelsOpen, setModelsOpen] = createSignal(false);

  /** One line under a role: its state, then the round, verdict, score or commit that the role has. */
  const roleLine = (role: RavenTeamRoleRun) => {
    const parts: string[] = [t(ROLE_STATE_KEY[role.state])];
    const builderAtWork =
      role.roleId === "builder" && (role.state === "working" || role.state === "blocked" || role.state === "failed");
    if (builderAtWork && !isTerminalJob(job()))
      parts.push(
        t("agent.team.job.round", { round: Math.min(job().fixRounds + 1, job().roundCap), cap: job().roundCap }),
      );
    if (role.verdict && role.verdict !== "DONE") parts.push(role.verdict);
    if (role.score !== null) parts.push(t("agent.team.role.score", { score: role.score }));
    else if (role.commit && (!role.verdict || role.verdict === "DONE")) parts.push(shortCommit(role.commit));
    return parts.join(" · ");
  };

  const meta = () =>
    [name().key, props.templateName, t("agent.team.job.rounds", { count: job().fixRounds, cap: job().roundCap })]
      .filter((part): part is string => Boolean(part))
      .join(" · ");

  return (
    <article
      class="raven-team-card raven-team-job"
      aria-label={firstLine(job().brief)}
      data-job-id={job().id}
      data-state={job().queued ? "queued" : job().state}
    >
      <header class="raven-team-job-head">
        <div class="raven-team-job-title">
          <h3 class="raven-team-job-brief">{name().title}</h3>
          <Show
            when={job().queued}
            fallback={
              <Badge variant={JOB_STATE_BADGE[job().state]} class="raven-team-job-state">
                <span class="raven-team-dot" aria-hidden="true" />
                {t(JOB_STATE_KEY[job().state])}
              </Badge>
            }
          >
            <Badge variant="secondary" class="raven-team-job-state">
              <span class="raven-team-dot" aria-hidden="true" />
              {t("agent.team.job.state.queued")}
            </Badge>
          </Show>
        </div>
        <span class="raven-team-job-meta">{meta()}</span>
      </header>
      <Show when={job().queued}>
        <p class="raven-team-job-queued">{t("agent.team.job.queuedHint")}</p>
      </Show>

      <ol class="raven-team-pipeline">
        <For each={job().roles}>
          {(role) => (
            <li class="raven-team-pipeline-step" data-state={role.state}>
              <span class="raven-team-pipeline-bar" aria-hidden="true" />
              <div class="raven-team-pipeline-body">
                <RavenTeamRoleIcon roleId={role.roleId} />
                <div class="raven-team-pipeline-text">
                  <span class="raven-team-role-label">{role.label}</span>
                  <span class="raven-team-role-state">{roleLine(role)}</span>
                </div>
              </div>
            </li>
          )}
        </For>
      </ol>

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
                <Alert tone="danger" role="alert" class="raven-team-access-banner">
                  <AlertIcon>
                    <TriangleAlert />
                  </AlertIcon>
                  <AlertContent>
                    <AlertTitle>{t("agent.team.access.title", { role: role().label })}</AlertTitle>
                    <AlertDescription>{props.accessText(role(), question().platform)}</AlertDescription>
                  </AlertContent>
                  <AlertActions>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={props.busy}
                      onClick={() =>
                        props.run(() => props.onGiveRoleFullAccess({ jobId: job().id, roleId: role().roleId }))
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

      <Show when={modelsOpen() && !isTerminalJob(job())}>
        <ul class="raven-team-job-roles">
          <For each={job().roles}>
            {(role) => (
              <li class="raven-team-job-role">
                <span class="raven-team-role-label">{role.label}</span>
                <RavenTeamRolePicker
                  role={role.label}
                  models={props.models}
                  model={role.model}
                  disabled={props.busy}
                  onModel={(model) =>
                    props.run(() => props.onSetRoleModel({ jobId: job().id, roleId: role.roleId, model }))
                  }
                />
              </li>
            )}
          </For>
        </ul>
      </Show>

      <footer class="raven-team-job-foot">
        <div class="raven-team-actions">
          <Show when={job().state === "stopped"}>
            <Button
              size="sm"
              variant="outline"
              disabled={props.busy}
              onClick={() => props.run(() => props.onResume(job().id))}
            >
              <Play aria-hidden="true" />
              {t("agent.team.job.resume")}
            </Button>
          </Show>
          <Show when={job().state === "running" || job().state === "waiting-user"}>
            <Button
              size="sm"
              variant="outline"
              disabled={props.busy}
              onClick={() => props.run(() => props.onStop(job().id))}
            >
              <Square aria-hidden="true" />
              {t("agent.team.job.stop")}
            </Button>
          </Show>
          <Show when={!isTerminalJob(job())}>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={modelsOpen() ? "true" : "false"}
              onClick={() => setModelsOpen(!modelsOpen())}
            >
              {modelsOpen() ? t("agent.team.job.hideModels") : t("agent.team.job.changeModels")}
            </Button>
          </Show>
        </div>
        <div class="raven-team-job-foot-end">
          <Show when={job().headCommit}>
            {(commit) => (
              <span class="raven-team-job-head-commit">
                <GitCommitHorizontal aria-hidden="true" />
                <code>{t("agent.team.job.head", { commit: shortCommit(commit()) })}</code>
              </span>
            )}
          </Show>
          {props.footer}
        </div>
      </footer>
    </article>
  );
}
