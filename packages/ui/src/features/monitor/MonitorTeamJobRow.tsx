/**
 * One team job in the "Live now" part of the Monitor sidebar: the first line of its ticket, its state,
 * and each team role with its state and a status dot. The job row opens the team page on the job; a
 * role row opens the role's work thread. A role without a work thread yet does not open.
 */

import type { AppTextKey } from "@openbot/i18n";
import { Button, UsersRound } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { useText } from "../../text";
import type { MonitorStatus } from "./monitor-status";
import { StatusDot } from "./StatusPill";

/**
 * One team job row. `state` of the job and of each role is the state that the host sends; it can be
 * one this build does not know.
 */
export interface MonitorTeamJobRowData {
  id: string;
  /** The first line of the ticket. */
  title: string;
  state: string;
  roles: readonly {
    key: string;
    label: string;
    state: string;
    /** What the role counts as in "Live now". */
    status: MonitorStatus;
    /** False before the role has a work thread. */
    canOpen: boolean;
  }[];
}

export interface MonitorTeamJobRowProps {
  job: MonitorTeamJobRowData;
  onOpenJob: () => void;
  onOpenRole: (roleKey: string) => void;
}

const JOB_STATE_LABEL: Readonly<Record<string, AppTextKey>> = {
  running: "agent.team.job.state.running",
  stopped: "agent.team.job.state.stopped",
  "waiting-user": "agent.team.job.state.waitingUser",
  done: "agent.team.job.state.done",
  "not-done": "agent.team.job.state.notDone",
};

const ROLE_STATE_LABEL: Readonly<Record<string, AppTextKey>> = {
  waiting: "agent.team.role.state.waiting",
  working: "agent.team.role.state.working",
  reported: "agent.team.role.state.reported",
  passed: "agent.team.role.state.passed",
  failed: "agent.team.role.state.failed",
  blocked: "agent.team.role.state.blocked",
  stopped: "agent.team.role.state.stopped",
};

const labelOf = (labels: Readonly<Record<string, AppTextKey>>, state: string): AppTextKey | undefined =>
  Object.hasOwn(labels, state) ? labels[state] : undefined;

export function MonitorTeamJobRow(props: MonitorTeamJobRowProps): JSX.Element {
  const { t } = useText();
  const title = () => props.job.title || t("monitor.team.untitled");
  const jobState = () => t(labelOf(JOB_STATE_LABEL, props.job.state) ?? "monitor.team.jobState.other");
  const roleState = (state: string) => t(labelOf(ROLE_STATE_LABEL, state) ?? "monitor.team.roleState.other");
  return (
    <div class="monitor-team-job" data-state={props.job.state}>
      <Button
        type="button"
        variant="ghost"
        class="monitor-team-job-row"
        aria-label={t("monitor.team.openJob", { ticket: title(), state: jobState() })}
        onClick={() => props.onOpenJob()}
      >
        <UsersRound class="monitor-team-job-icon" aria-hidden="true" />
        <span class="monitor-row-copy">
          <span class="monitor-row-title">{title()}</span>
          <span class="monitor-row-meta">{jobState()}</span>
        </span>
      </Button>
      <ul class="monitor-team-roles">
        <For each={props.job.roles} keyed={(role) => role.key}>
          {(role) => (
            <li>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="monitor-team-role"
                data-status={role().status}
                disabled={!role().canOpen}
                aria-label={
                  role().canOpen
                    ? t("monitor.team.openRole", { role: role().label, state: roleState(role().state) })
                    : t("monitor.team.role", { role: role().label, state: roleState(role().state) })
                }
                onClick={() => props.onOpenRole(role().key)}
              >
                <span class="monitor-team-role-label">{role().label}</span>
                <span class="monitor-team-role-state">{roleState(role().state)}</span>
                <StatusDot status={role().status} class="monitor-agent-row-dot" />
              </Button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
