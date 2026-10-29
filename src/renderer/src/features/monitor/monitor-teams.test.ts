import type { RavenTeamJob, RavenTeamRoleRun } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import type { MonitorOverviewAgent } from "./monitor-overview";
import {
  countLiveWork,
  isActiveTeamJobState,
  MONITOR_TEAM_ENDED_VISIBLE_MS,
  summarizeMonitorTeams,
  teamRoleStatus,
} from "./monitor-teams";

const NOW = new Date("2026-10-29T01:00:00.000Z");
const AT = "2026-10-29T00:59:00.000Z";

// `Object.assign` keeps a state that this build does not know, as a newer host can send one.
const role = (roleId: string, state: string, agentId: string | null = `agent-${roleId}`): RavenTeamRoleRun =>
  Object.assign(baseRole(roleId, agentId), { state });

const baseRole = (roleId: string, agentId: string | null): RavenTeamRoleRun => ({
  roleId,
  label: roleId.charAt(0).toUpperCase() + roleId.slice(1),
  agentId,
  taskId: agentId ? `task-${roleId}` : null,
  threadId: agentId ? `thread-${roleId}` : null,
  provider: "codex",
  model: "gpt-6-luna",
  access: "read-only",
  state: "waiting",
  verdict: null,
  score: null,
  commit: null,
  fails: 0,
  updatedAt: AT,
});

const job = (id: string, state: string, roles: RavenTeamRoleRun[], extra: Partial<RavenTeamJob> = {}): RavenTeamJob =>
  Object.assign(
    {
      id,
      templateId: "raven-stack-team",
      brief: `PUU-${id}: Fix the login\n\nMore detail.`,
      state: "running" as const,
      headCommit: null,
      fixRounds: 0,
      roundCap: 3,
      fallbackModel: null,
      question: null,
      roles,
      createdAt: AT,
      updatedAt: AT,
      ...extra,
    },
    { state },
  );

const agent = (id: string, status: MonitorOverviewAgent["status"]): MonitorOverviewAgent => ({
  id,
  name: id,
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
  status,
  detail: null,
  since: null,
  channelId: "c1",
  channelName: "general",
  lead: false,
  provider: "codex",
});

describe("teamRoleStatus", () => {
  it("counts a working role as working and a blocked role as error", () => {
    const running = job("1", "running", []);
    expect(teamRoleStatus(running, role("builder", "working"))).toBe("working");
    expect(teamRoleStatus(running, role("reviewer", "blocked"))).toBe("error");
    expect(teamRoleStatus(running, role("quality", "waiting"))).toBe("idle");
    expect(teamRoleStatus(running, role("architect", "passed"))).toBe("idle");
  });

  it("counts the role that the question waits on as waiting", () => {
    const asking = job("1", "waiting-user", [], { question: { kind: "fallback-model", roleId: "builder" } });
    expect(teamRoleStatus(asking, role("builder", "working"))).toBe("waiting");
    expect(teamRoleStatus(asking, role("reviewer", "working"))).toBe("working");
  });

  it("counts every role of an ended job as idle", () => {
    for (const state of ["done", "not-done", "stopped"]) {
      expect(teamRoleStatus(job("1", state, []), role("builder", "working"))).toBe("idle");
    }
  });

  it("treats unknown states gracefully", () => {
    expect(isActiveTeamJobState("queued")).toBe(true);
    expect(teamRoleStatus(job("1", "queued", []), role("builder", "working"))).toBe("working");
    expect(teamRoleStatus(job("1", "running", []), role("builder", "thinking-hard"))).toBe("idle");
  });
});

describe("summarizeMonitorTeams", () => {
  it("lists active jobs first and keeps recently ended jobs only", () => {
    const old = new Date(NOW.getTime() - MONITOR_TEAM_ENDED_VISIBLE_MS - 1).toISOString();
    const teams = summarizeMonitorTeams(
      [
        job("done-recent", "done", [role("builder", "passed")]),
        job("done-old", "done", [role("builder", "passed")], { updatedAt: old }),
        job("run", "running", [role("builder", "working"), role("reviewer", "waiting", null)]),
      ],
      NOW,
    );
    expect(teams.map((team) => team.id)).toEqual(["run", "done-recent"]);
    expect(teams[0]).toMatchObject({ title: "PUU-run: Fix the login", active: true, state: "running" });
    expect(teams[0]?.roles.map((entry) => [entry.key, entry.status, entry.taskId])).toEqual([
      ["run:builder", "working", "task-builder"],
      ["run:reviewer", "idle", null],
    ]);
  });
});

describe("countLiveWork", () => {
  it("adds team role work threads to the channel agents", () => {
    const teams = summarizeMonitorTeams(
      [
        job(
          "1",
          "waiting-user",
          [role("builder", "working"), role("reviewer", "blocked"), role("quality", "working")],
          {
            question: { kind: "fallback-model", roleId: "builder" },
          },
        ),
      ],
      NOW,
    );
    expect(countLiveWork([agent("a1", "working"), agent("a2", "idle")], teams)).toEqual({
      working: 2,
      waiting: 1,
      error: 1,
    });
  });

  it("shows Working 1 for a running job with no channel agents", () => {
    const teams = summarizeMonitorTeams([job("1", "running", [role("architect", "working")])], NOW);
    expect(countLiveWork([], teams)).toEqual({ working: 1, waiting: 0, error: 0 });
  });

  it("counts one work thread per role across two jobs on the same role agent", () => {
    const teams = summarizeMonitorTeams(
      [
        job("1", "running", [{ ...role("builder", "working"), taskId: "t1" }]),
        job("2", "running", [{ ...role("builder", "working"), taskId: "t2" }]),
      ],
      NOW,
    );
    expect(countLiveWork([], teams).working).toBe(2);
  });

  it("counts an agent that is a channel agent and a role once, with the status that needs the user first", () => {
    const teams = summarizeMonitorTeams([job("1", "running", [role("builder", "blocked", "a1")])], NOW);
    expect(countLiveWork([agent("a1", "working")], teams)).toEqual({ working: 0, waiting: 0, error: 1 });
  });
});
