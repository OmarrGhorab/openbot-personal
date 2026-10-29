// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTask, RavenTeamJob, RavenTeamRoleRun } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";
import { BoardTicketTeamFollower } from "./board-ticket-team-follower";
import { BoardTicketWorkFollower } from "./board-ticket-work-follower";

// Failure modes: a team job puts one card on the board, so nobody sees which role is working; a role
// ticket is not assigned to its role's agent; each change of the job adds another copy of its tickets;
// a queued job shows Running; a role ticket stays in Backlog after its thread starts, or does not follow
// its thread to Needs review or back to Backlog; a stopped or failed job leaves its ticket in Running with
// no reason; a pass leaves the role tickets open; a change of the job drags a card the person moved.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function harness() {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-team-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const board = new BoardTicketService({ store: new BoardTicketStore(database), changed: () => undefined });
  const team = new BoardTicketTeamFollower(board);
  const work = new BoardTicketWorkFollower(board);
  const tickets = (jobId: string) => board.forTeamJob(jobId);
  const roleTicket = (jobId: string, roleId: string) => tickets(jobId).find((ticket) => ticket.teamRoleId === roleId);
  const jobTicket = (jobId: string) => tickets(jobId).find((ticket) => ticket.teamRoleId === null);
  return { board, team, work, tickets, roleTicket, jobTicket };
}

const TIME = "Thu 2026-10-29 11:00 AM EEST (UTC+03:00)";

function role(roleId: string, label: string, change: Partial<RavenTeamRoleRun> = {}): RavenTeamRoleRun {
  return {
    roleId,
    label,
    agentId: `agent-${roleId}`,
    taskId: null,
    threadId: null,
    provider: "codex",
    model: "gpt-6-luna",
    access: roleId === "builder" ? "write" : "read-only",
    state: "waiting",
    verdict: null,
    score: null,
    commit: null,
    fails: 0,
    updatedAt: TIME,
    ...change,
  };
}

/** An Autopilot lite job: a Builder and a Reviewer. */
function job(change: Partial<RavenTeamJob> = {}, roles?: RavenTeamRoleRun[]): RavenTeamJob {
  return {
    id: "job-1",
    templateId: "raven-stack-lite",
    brief: "Fix the login timeout\n\nSessions end after 5 minutes. They should last 30.",
    state: "running",
    queued: false,
    headCommit: null,
    fixRounds: 0,
    roundCap: 3,
    fallbackModel: null,
    question: null,
    roles: roles ?? [
      role("builder", "Builder", { state: "working", taskId: "task-builder", threadId: "thread-builder" }),
      role("reviewer", "Reviewer"),
    ],
    createdAt: TIME,
    updatedAt: TIME,
    ...change,
  };
}

function thread(id: string, agentId: string, state: AgentTask["state"], change: Partial<AgentTask> = {}): AgentTask {
  return {
    id,
    agentId,
    threadId: `thread-${id}`,
    origin: "user",
    title: "Fix the login timeout",
    state,
    outcome: null,
    hold: null,
    activeTurnId: state === "running" ? "turn-1" : null,
    progress: null,
    error: null,
    queuedMessages: [],
    createdAt: TIME,
    updatedAt: TIME,
    closedAt: null,
    question: null,
    ...change,
  };
}

describe("board ticket team follower", () => {
  it("gives the job a ticket and each role its own ticket, assigned to the role's agent", async () => {
    const { team, tickets, roleTicket, jobTicket } = await harness();
    team.follow(job());

    const parent = jobTicket("job-1");
    expect(parent).toMatchObject({
      title: "Fix the login timeout",
      status: "running",
      agentId: null,
      teamJobId: "job-1",
      teamRoleId: null,
      taskId: null,
    });
    expect(parent?.body).toContain("They should last 30.");
    expect(roleTicket("job-1", "builder")).toMatchObject({
      title: "Builder: Fix the login timeout",
      status: "running",
      agentId: "agent-builder",
      taskId: "task-builder",
      threadId: "thread-builder",
      teamJobId: "job-1",
    });
    expect(roleTicket("job-1", "reviewer")).toMatchObject({
      title: "Reviewer: Fix the login timeout",
      status: "backlog",
      agentId: "agent-reviewer",
      taskId: null,
    });

    team.follow(job());
    expect(tickets("job-1")).toHaveLength(3);
  });

  it("keeps a queued job's tickets in Queued, then moves them when the job starts", async () => {
    const { team, roleTicket, jobTicket } = await harness();
    team.follow(job({ queued: true }, [role("builder", "Builder"), role("reviewer", "Reviewer")]));
    expect(jobTicket("job-1")?.status).toBe("queued");
    expect(roleTicket("job-1", "builder")?.status).toBe("queued");
    expect(roleTicket("job-1", "reviewer")?.status).toBe("queued");

    team.follow(job());
    expect(jobTicket("job-1")?.status).toBe("running");
    expect(roleTicket("job-1", "builder")).toMatchObject({ status: "running", taskId: "task-builder" });
    expect(roleTicket("job-1", "reviewer")?.status).toBe("backlog");
  });

  it("links a role ticket to the role's new work thread, which then moves it by the work rules", async () => {
    const { team, work, roleTicket } = await harness();
    team.follow(job());
    const reviewing = job({}, [
      role("builder", "Builder", { state: "reported", taskId: "task-builder", threadId: "thread-builder" }),
      role("reviewer", "Reviewer", { state: "working", taskId: "task-reviewer", threadId: "thread-reviewer" }),
    ]);
    team.follow(reviewing);
    expect(roleTicket("job-1", "reviewer")).toMatchObject({
      status: "running",
      taskId: "task-reviewer",
      threadId: "thread-reviewer",
    });

    work.follow({
      agentId: "agent-builder",
      tasks: [thread("task-builder", "agent-builder", "idle", { outcome: "completed" })],
      limit: 2,
    });
    expect(roleTicket("job-1", "builder")?.status).toBe("needs_review");
    work.follow({
      agentId: "agent-reviewer",
      tasks: [thread("task-reviewer", "agent-reviewer", "idle", { outcome: "failed", error: "Out of credit" })],
      limit: 2,
    });
    expect(roleTicket("job-1", "reviewer")).toMatchObject({ status: "backlog", error: "Out of credit" });
    work.follow({ agentId: "agent-reviewer", tasks: [thread("task-reviewer", "agent-reviewer", "queued")], limit: 2 });
    expect(roleTicket("job-1", "reviewer")?.status).toBe("queued");
  });

  it("puts a stopped job back in Backlog with the reason, and runs it again on resume", async () => {
    const { team, roleTicket, jobTicket } = await harness();
    team.follow(job());
    team.follow(job({ state: "stopped" }));
    const stopped = sourceText("error.agent.boardTickets.teamJobStopped");
    expect(jobTicket("job-1")).toMatchObject({ status: "backlog", error: stopped });
    expect(roleTicket("job-1", "reviewer")).toMatchObject({ status: "backlog", error: stopped });

    team.follow(job());
    expect(jobTicket("job-1")).toMatchObject({ status: "running", error: null });
    expect(roleTicket("job-1", "reviewer")).toMatchObject({ status: "backlog", error: null });
  });

  it("moves the job ticket and every role ticket to Done when the job passes", async () => {
    const { team, roleTicket, jobTicket } = await harness();
    team.follow(job());
    team.follow(job({ state: "waiting-user" }));
    expect(jobTicket("job-1")?.status).toBe("needs_review");
    team.follow(job({ state: "done" }));
    expect(jobTicket("job-1")?.status).toBe("done");
    expect(roleTicket("job-1", "builder")?.status).toBe("done");
    expect(roleTicket("job-1", "reviewer")?.status).toBe("done");
  });

  it("gives a job that ends not done a failure line and leaves its role tickets where their threads put them", async () => {
    const { team, roleTicket, jobTicket } = await harness();
    team.follow(job());
    team.follow(job({ state: "not-done" }));
    expect(jobTicket("job-1")).toMatchObject({
      status: "backlog",
      error: sourceText("error.agent.boardTickets.teamJobNotDone"),
    });
    expect(roleTicket("job-1", "builder")?.status).toBe("running");
  });

  it("leaves a card the person dragged until the job asks for another column", async () => {
    const { board, team, jobTicket } = await harness();
    team.follow(job());
    const parent = jobTicket("job-1");
    if (!parent) throw new Error("The job has no ticket.");
    board.move({ ticketId: parent.id, status: "needs_review" });

    team.follow(job({ headCommit: "abc1234" }));
    expect(jobTicket("job-1")?.status).toBe("needs_review");
    team.follow(job({ state: "done" }));
    expect(jobTicket("job-1")?.status).toBe("done");
  });
});
