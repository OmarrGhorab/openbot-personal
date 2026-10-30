import {
  type BoardTicketProvider,
  type RavenTeamJob,
  type TicketTakenPhase,
  type TicketTakenStepId,
  ticketTakenPhase,
  ticketTakenSteps,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Check, CircleX, LoaderCircle, Plug } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { autopilotReasonText, TicketStackPill } from "./TicketAutopilotDecision";
import { TicketTypeChip } from "./TicketTypeChip";

const STEP_TEXT = {
  plan: "tickets.taken.step.plan",
  build: "tickets.taken.step.build",
  review: "tickets.taken.step.review",
  merge: "tickets.taken.step.merge",
} as const satisfies Record<TicketTakenStepId, AppTextKey>;

const PHASE_TEXT = {
  queued: "tickets.taken.phase.queued",
  working: "tickets.taken.phase.working",
  "needs-you": "tickets.taken.phase.needsYou",
  stopped: "tickets.taken.phase.stopped",
  passed: "tickets.taken.phase.passed",
  merged: "tickets.taken.phase.merged",
  "not-done": "tickets.taken.phase.notDone",
} as const satisfies Record<TicketTakenPhase, AppTextKey>;

const PROVIDER_TEXT = {
  github: "tickets.sync.provider.github",
  jira: "tickets.sync.provider.jira",
  linear: "tickets.sync.provider.linear",
} as const satisfies Record<BoardTicketProvider, AppTextKey>;

/** Minutes since the job started, for the live pill. The card reads the clock again each 30 seconds. */
function useMinutesSince(start: () => string) {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));
  return () => {
    const started = Date.parse(start());
    return Number.isFinite(started) ? Math.max(0, Math.floor((now() - started) / 60_000)) : 0;
  };
}

interface TicketTakenCardProps {
  /** The job of the taken ticket. Its decision names the stack, the models and why. */
  job: RavenTeamJob;
  /** The issue key, such as `PROJ-482`. Null for a ticket that lives on this computer only. */
  ticketKey: string | null;
  /** True when the Reviewer may merge this ticket's type now. The checklist then has a merge step. */
  mayMerge: boolean;
  /** True when the person gets a notification at a merge (Autopilot settings). */
  notifyOnMerge: boolean;
  onOpenBoard: (trigger: HTMLElement) => void;
  /** Stops the job. The ticket stays in Needs review ("Needs you"). */
  onStop: (jobId: string) => Promise<unknown>;
}

/**
 * The "Ticket taken" card of a chat (#200, Figma 167-2054): the agent took a ticket from a message. It shows
 * the type, the key and the title, the stack chosen and why, the model of each role, a live checklist, and
 * "Open on the board" and "Stop". The parent gives the job again at each job change, so the card is live.
 */
export function TicketTakenCard(props: TicketTakenCardProps) {
  const { t, errorMessage } = useText();
  const [stopping, setStopping] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const minutes = useMinutesSince(() => props.job.createdAt);
  const decision = () => props.job.decision;
  const phase = () => ticketTakenPhase(props.job);
  const steps = () => ticketTakenSteps(props.job, props.mayMerge);
  const title = () => {
    const full = decision()?.ticketTitle ?? props.job.brief.split("\n")[0] ?? "";
    const key = props.ticketKey;
    return key && full.startsWith(`${key}: `) ? full.slice(key.length + 2) : full;
  };
  const live = () => phase() === "working" || phase() === "queued" || phase() === "needs-you";
  const stop = async () => {
    setStopping(true);
    setError(null);
    try {
      await props.onStop(props.job.id);
    } catch (cause) {
      setError(errorMessage(cause, t("tickets.taken.stopFailed")));
    } finally {
      setStopping(false);
    }
  };
  return (
    <section class="ticket-taken" aria-label={t("tickets.taken.label")}>
      <p class="ticket-taken-say">
        {props.ticketKey ? t("tickets.taken.intro", { key: props.ticketKey }) : t("tickets.taken.introLocal")}
      </p>
      <div class="ticket-taken-card" data-phase={phase()}>
        <div class="ticket-taken-head">
          <TicketTypeChip type={decision()?.ticketType ?? null} />
          <Show when={props.ticketKey}>{(key) => <span class="ticket-taken-key">{key()}</span>}</Show>
          <span class="ticket-taken-title">{title()}</span>
          <span class="ticket-taken-live" data-phase={phase()} role="status">
            <span class="ticket-taken-live-dot" aria-hidden="true" />
            {phase() === "working"
              ? t("tickets.taken.phase.workingFor", { minutes: minutes() })
              : t(PHASE_TEXT[phase()])}
          </span>
        </div>
        <Show when={decision()}>
          {(chosen) => (
            <div class="ticket-taken-decision">
              <div class="ticket-taken-decision-row">
                <span class="ticket-taken-label">{t("tickets.taken.stackChosen")}</span>
                <TicketStackPill decision={chosen()} />
                <ul class="ticket-taken-models" aria-label={t("tickets.autopilot.models")}>
                  <For each={chosen().roles} keyed={(role) => role.roleId}>
                    {(role) => (
                      <li class="ticket-taken-model" title={role().label}>
                        <span class="ticket-taken-role">{role().label}</span>
                        {role().model}
                      </li>
                    )}
                  </For>
                </ul>
              </div>
              <p class="ticket-taken-reason">{autopilotReasonText(chosen(), t)}</p>
            </div>
          )}
        </Show>
        <ol class="ticket-taken-steps" aria-label={t("tickets.taken.steps")}>
          <For each={steps()} keyed={(step) => step.id}>
            {(step) => (
              <li class="ticket-taken-step" data-state={step().state}>
                <span class="ticket-taken-mark" aria-hidden="true">
                  <Show when={step().state === "done"}>
                    <Check />
                  </Show>
                  <Show when={step().state === "active"}>
                    <LoaderCircle />
                  </Show>
                  <Show when={step().state === "failed"}>
                    <CircleX />
                  </Show>
                </span>
                {t(STEP_TEXT[step().id])}
              </li>
            )}
          </For>
        </ol>
        <div class="ticket-taken-footer">
          <Button
            variant="secondary"
            size="sm"
            onClick={(event) => props.onOpenBoard(event.currentTarget)}
          >
            {t("tickets.taken.openBoard")}
          </Button>
          <Show when={live()}>
            <Button variant="ghost" size="sm" disabled={stopping()} onClick={() => void stop()}>
              {t("tickets.taken.stop")}
            </Button>
          </Show>
          <span class="ticket-taken-note">
            {props.mayMerge && props.notifyOnMerge ? t("tickets.taken.notifyMerge") : t("tickets.taken.waitsReview")}
          </span>
        </div>
        <Show when={error()}>{(text) => <p class="ticket-taken-error">{text()}</p>}</Show>
      </div>
      <p class="ticket-taken-say">{t("tickets.taken.steer")}</p>
    </section>
  );
}

interface TicketTakeNoticeProps {
  /** `connect`: the ticket system is not connected. `failed`: the ticket was found, but no job started. */
  kind: "connect" | "failed";
  ticketKey: string;
  provider?: BoardTicketProvider | null;
  reason?: string;
  /** Opens the place where the person connects the system. Absent: the card only says what to do. */
  onConnect?: ((provider: BoardTicketProvider) => void) | undefined;
}

/** The agent's answer when it cannot take the ticket: connect the ticket system first, or why no job started. */
export function TicketTakeNotice(props: TicketTakeNoticeProps) {
  const { t } = useText();
  const providerName = () => (props.provider ? t(PROVIDER_TEXT[props.provider]) : "");
  return (
    <section class="ticket-taken" aria-label={t("tickets.taken.label")}>
      <div class="ticket-taken-card ticket-taken-notice" data-kind={props.kind}>
        <Show
          when={props.kind === "connect"}
          fallback={
            <p class="ticket-taken-reason">
              {t("tickets.taken.failed", { key: props.ticketKey, reason: props.reason ?? "" })}
            </p>
          }
        >
          <p class="ticket-taken-reason">
            {props.provider === "linear"
              ? t("tickets.taken.connectLinear", { key: props.ticketKey })
              : t("tickets.taken.connect", { key: props.ticketKey, provider: providerName() })}
          </p>
          <Show when={props.onConnect && props.provider && props.provider !== "linear" ? props.provider : null}>
            {(provider) => (
              <div class="ticket-taken-footer">
                <Button variant="secondary" size="sm" onClick={() => props.onConnect?.(provider())}>
                  <Plug aria-hidden="true" />
                  {t("tickets.taken.connectAction", { provider: providerName() })}
                </Button>
              </div>
            )}
          </Show>
        </Show>
      </div>
    </section>
  );
}
