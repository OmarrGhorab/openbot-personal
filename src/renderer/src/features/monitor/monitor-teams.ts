import type { MonitorAgentStatus, RavenTeamJob, RavenTeamRoleRun } from "@openbot/contracts/ipc";
import type { MonitorOverviewAgent } from "./monitor-overview";

/**
 * The team jobs that "Live now" shows. A Raven Stack team job runs on this computer; each team role is
 * one agent with its own work thread. The Monitor reads the jobs through the `ravenTeam` group and
 * never changes them.
 *
 * The job and role states are strings here, not the union of the contract: a newer host can send a
 * state that this build does not know, such as a queued job. An unknown job state counts as active,
 * and an unknown role state counts as idle.
 */

/** The job states after which no role of the job works. */
const ENDED_JOB_STATES: ReadonlySet<string> = new Set(["done", "not-done", "stopped"]);

/** How long an ended job stays in the list, so the user sees how it ended. */
export const MONITOR_TEAM_ENDED_VISIBLE_MS = 15 * 60_000;

/** One team job, as the Monitor sidebar shows it. */
export interface MonitorTeamJob {
  id: string;
  /** The first line of the ticket. */
  title: string;
  /** The state of the job, as the host sends it. */
  state: string;
  /** False when the job is done, not done or stopped. Its roles then count as idle. */
  active: boolean;
  /** Each team role of the job. */
  roles: {
    /** Unique over the jobs: the job id and the role id. */
    key: string;
    roleId: string;
    label: string;
    /** The role's agent, or null before the role starts. */
    agentId: string | null;
    /** The role's work thread, or null before the role starts. */
    taskId: string | null;
    /** The state of the role in the job, as the host sends it. */
    state: string;
    /** What the role counts as in "Live now". */
    status: MonitorAgentStatus;
  }[];
  updatedAt: string;
}

/** Whether a role of a job in this state can still work. An unknown state counts as active. */
export function isActiveTeamJobState(state: string): boolean {
  return !ENDED_JOB_STATES.has(state);
}

/** The first line of a ticket, which names the job. */
function teamJobTitle(brief: string): string {
  return (brief.split("\n")[0] ?? "").trim();
}

/**
 * What a team role counts as in "Live now":
 * - `error` when the role is blocked,
 * - `waiting` when the job's question waits for the user on this role,
 * - `working` while the role has a turn to do,
 * - `idle` otherwise, and for every role of an ended job.
 */
export function teamRoleStatus(
  job: Pick<RavenTeamJob, "state" | "question">,
  role: Pick<RavenTeamRoleRun, "roleId" | "state">,
): MonitorAgentStatus {
  if (!isActiveTeamJobState(job.state)) return "idle";
  const state: string = role.state;
  if (state === "blocked") return "error";
  if (job.question !== null && job.question.roleId === role.roleId) return "waiting";
  return state === "working" ? "working" : "idle";
}

const timeOf = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The jobs that "Live now" lists: every active job, and the jobs that ended in the last
 * `MONITOR_TEAM_ENDED_VISIBLE_MS`. Active jobs come first, then the newest change first.
 */
export function summarizeMonitorTeams(jobs: readonly RavenTeamJob[], now: Date): MonitorTeamJob[] {
  const listed: MonitorTeamJob[] = [];
  for (const job of jobs) {
    const active = isActiveTeamJobState(job.state);
    if (!active) {
      const changed = timeOf(job.updatedAt);
      if (changed === null || now.getTime() - changed > MONITOR_TEAM_ENDED_VISIBLE_MS) continue;
    }
    listed.push({
      id: job.id,
      title: teamJobTitle(job.brief),
      state: job.state,
      active,
      updatedAt: job.updatedAt,
      roles: job.roles.map((role) => ({
        key: `${job.id}:${role.roleId}`,
        roleId: role.roleId,
        label: role.label,
        agentId: role.agentId,
        taskId: role.taskId,
        state: role.state,
        status: teamRoleStatus(job, role),
      })),
    });
  }
  return listed.sort(
    (left, right) =>
      Number(right.active) - Number(left.active) || (timeOf(right.updatedAt) ?? 0) - (timeOf(left.updatedAt) ?? 0),
  );
}

/** Which status wins when one agent has two: the one that needs the user first. */
const STATUS_RANK = { error: 3, waiting: 2, working: 1, idle: 0 } as const satisfies Record<MonitorAgentStatus, number>;

/**
 * The "Live now" counts over the channel agents and the team role work threads. Each work thread
 * counts once. When a role's agent is also a channel agent, the agent counts once, with the status
 * that needs the user first, so one agent is never counted twice.
 */
export function countLiveWork(
  agents: readonly Pick<MonitorOverviewAgent, "id" | "status">[],
  teams: readonly MonitorTeamJob[],
) {
  const statuses = new Map<string, MonitorAgentStatus>();
  for (const agent of agents) statuses.set(`agent:${agent.id}`, agent.status);
  for (const job of teams) {
    for (const role of job.roles) {
      const asAgent = role.agentId === null ? null : `agent:${role.agentId}`;
      const key =
        asAgent !== null && statuses.has(asAgent) ? asAgent : `thread:${role.agentId ?? ""}:${role.taskId ?? role.key}`;
      const current = statuses.get(key);
      if (current === undefined || STATUS_RANK[role.status] > STATUS_RANK[current]) statuses.set(key, role.status);
    }
  }
  const counts = { working: 0, waiting: 0, error: 0 };
  for (const status of statuses.values()) if (status !== "idle") counts[status] += 1;
  return counts;
}
