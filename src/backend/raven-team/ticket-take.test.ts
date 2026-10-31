import {
  type BoardTicket,
  type BoardTicketProvider,
  detectTicketTakeRequest,
  type RavenTeamJob,
  ticketTakenPhase,
  ticketTakenSteps,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { TicketTakeService } from "./ticket-take";

describe("detectTicketTakeRequest", () => {
  it("reads a Jira key with the system named", () => {
    expect(detectTicketTakeRequest("take this ticket in jira fix it PROJ-482")).toEqual({
      provider: "jira",
      key: "PROJ-482",
      url: null,
    });
  });

  it("reads a Jira, GitHub and Linear link", () => {
    expect(detectTicketTakeRequest("fix https://acme.atlassian.net/browse/PROJ-482.")).toEqual({
      provider: "jira",
      key: "PROJ-482",
      url: "https://acme.atlassian.net/browse/PROJ-482",
    });
    expect(detectTicketTakeRequest("please work on https://github.com/acme/shop/issues/12")).toEqual({
      provider: "github",
      key: "acme/shop#12",
      url: "https://github.com/acme/shop/issues/12",
    });
    expect(detectTicketTakeRequest("take https://linear.app/acme/issue/PH-88/coupon-rounding")).toMatchObject({
      provider: "linear",
      key: "PH-88",
    });
  });

  it("reads a GitHub short key and gives its page", () => {
    expect(detectTicketTakeRequest("can you fix acme/shop#7")).toEqual({
      provider: "github",
      key: "acme/shop#7",
      url: "https://github.com/acme/shop/issues/7",
    });
  });

  it("needs a take intent and a ticket", () => {
    expect(detectTicketTakeRequest("what is PROJ-482 about?")).toBeNull();
    expect(detectTicketTakeRequest("fix the login page")).toBeNull();
    expect(detectTicketTakeRequest("fix the UTF-8 decoding")).toBeNull();
  });

  it("reads an Arabic request", () => {
    expect(detectTicketTakeRequest("خد التذكرة PROJ-9 من جيرا وصلحها")).toMatchObject({
      provider: "jira",
      key: "PROJ-9",
    });
  });
});

function ticket(patch: Partial<BoardTicket>): BoardTicket {
  return {
    id: "ticket-1",
    title: "Checkout fails when the cart has a coupon",
    body: "",
    status: "backlog",
    type: "bug",
    typeSource: "detected",
    agentId: null,
    order: 1,
    taskId: null,
    threadId: null,
    teamJobId: null,
    teamRoleId: null,
    external: null,
    progress: null,
    error: null,
    statusTimes: {},
    statusChangedAt: "2026-10-30T04:00:00.000Z",
    createdAt: "2026-10-30T04:00:00.000Z",
    updatedAt: "2026-10-30T04:00:00.000Z",
    ...patch,
  };
}

function job(patch: Partial<RavenTeamJob> = {}): RavenTeamJob {
  return {
    id: "job-1",
    templateId: "raven-stack-lite",
    brief: "Checkout fails",
    state: "running",
    queued: false,
    headCommit: null,
    fixRounds: 0,
    roundCap: 3,
    fallbackModel: null,
    question: null,
    roles: [],
    decision: null,
    createdAt: "2026-10-30T04:00:00.000Z",
    updatedAt: "2026-10-30T04:00:00.000Z",
    ...patch,
  };
}

function harness(options: {
  tickets?: BoardTicket[];
  connected?: BoardTicketProvider[];
  imported?: BoardTicket | null;
}) {
  const tickets = [...(options.tickets ?? [])];
  const created: BoardTicket[] = [];
  const starts: { ticketId: string; agentId: string; brief: string }[] = [];
  const binds: { ticketId: string; agentId: string; threadId: string }[] = [];
  const replace = (next: BoardTicket) => {
    tickets[tickets.findIndex((candidate) => candidate.id === next.id)] = next;
    return next;
  };
  const service = new TicketTakeService({
    board: {
      list: () => tickets,
      get: (id) => tickets.find((candidate) => candidate.id === id) ?? null,
      create: (input, _actor, links) => {
        const made = ticket({ id: `new-${created.length + 1}`, title: input.title, external: links?.external ?? null });
        created.push(made);
        tickets.push(made);
        return made;
      },
      bindChat: (ticketId, agentId, threadId) => {
        binds.push({ ticketId, agentId, threadId });
        const current = tickets.find((candidate) => candidate.id === ticketId);
        return replace(ticket({ ...current, agentId, threadId, status: "running" }));
      },
      startFromChat: async (ticketId, agentId, brief) => {
        starts.push({ ticketId, agentId, brief });
        const current = tickets.find((candidate) => candidate.id === ticketId);
        return replace(
          ticket({ ...current, agentId, taskId: "task-9", threadId: "thread-9", status: "running", phase: "take" }),
        );
      },
    },
    sync: {
      connected: () => options.connected ?? [],
      importIssueByKey: (_provider, key) =>
        Effect.sync(() => {
          if (!options.imported) return null;
          tickets.push(options.imported);
          return key;
        }),
    },
    agentThread: (agentId) => (agentId === "agent-1" ? "thread-1" : undefined),
  });
  return { service, created, starts, binds, tickets };
}

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

const GITHUB_12 = { provider: "github", key: "acme/shop#12", url: "https://github.com/acme/shop/issues/12" } as const;

describe("TicketTakeService", () => {
  // #263: `take ticket "Bug: sub.js…"` named a board ticket by its cut title, and nothing moved.
  it("links a board ticket named by its quoted title to the chat's thread, once", async () => {
    const { service, binds, starts, tickets } = harness({
      tickets: [
        ticket({ id: "t-sub", title: "Bug: sub.js returns wrong result" }),
        ticket({ id: "t-mul", title: "Bug: mul.js returns wrong result" }),
      ],
    });
    const first = await run(service.take({ agentId: "agent-1", text: 'take ticket "Bug: sub.js…"' }));
    expect(first).toEqual({ outcome: "linked", ticketId: "t-sub", already: false });
    expect(binds).toEqual([{ ticketId: "t-sub", agentId: "agent-1", threadId: "thread-1" }]);
    expect(tickets.find((item) => item.id === "t-sub")?.status).toBe("running");
    const again = await run(
      service.take({ agentId: "agent-1", text: 'take ticket "Bug: sub.js returns wrong result"' }),
    );
    expect(again).toEqual({ outcome: "linked", ticketId: "t-sub", already: true });
    expect(binds).toHaveLength(1);
    expect(starts).toEqual([]);
  });

  it("does not link a cut title that names two tickets, or a message that does not say ticket", async () => {
    const { service, binds } = harness({
      tickets: [ticket({ id: "t-sub", title: "Bug: sub.js" }), ticket({ id: "t-sub2", title: "Bug: sub.js again" })],
    });
    expect(await run(service.take({ agentId: "agent-1", text: 'take ticket "Bug: su…"' }))).toEqual({
      outcome: "none",
    });
    expect(await run(service.take({ agentId: "agent-1", text: 'please fix "Bug: sub.js"' }))).toEqual({
      outcome: "none",
    });
    expect(binds).toEqual([]);
  });

  // Ticket 238: the take starts a ticket-factory work thread, not a Raven team job.
  it("starts a ticket-factory work thread for a GitHub issue on the board, in English and Arabic", async () => {
    for (const text of ["take ticket acme/shop#12", "خد التذكرة acme/shop#12"]) {
      const { service, starts } = harness({
        tickets: [ticket({ id: "t-12", title: "Checkout fails", external: GITHUB_12 })],
      });
      const result = await run(service.take({ agentId: "agent-1", text }));
      expect(result).toEqual({ outcome: "linked", ticketId: "t-12", already: false, title: "Checkout fails" });
      expect(starts).toHaveLength(1);
      expect(starts[0]?.brief).toContain("$ticket-factory");
      expect(starts[0]?.brief).toContain("--- external ticket input ---");
    }
  });

  it("imports the issue when GitHub is connected", async () => {
    const imported = ticket({ id: "synced", external: GITHUB_12 });
    const { service, created, starts } = harness({ connected: ["github"], imported });
    const result = await run(
      service.take({ agentId: "agent-1", text: "work on https://github.com/acme/shop/issues/12" }),
    );
    expect(result).toMatchObject({ outcome: "linked", ticketId: "synced" });
    expect(created).toEqual([]);
    expect(starts).toHaveLength(1);
  });

  it("asks to connect GitHub for an unknown issue, and refuses a closed one without adding a ticket", async () => {
    const notConnected = harness({});
    expect(await run(notConnected.service.take({ agentId: "agent-1", text: "fix acme/shop#3" }))).toEqual({
      outcome: "connect",
      key: "acme/shop#3",
      provider: "github",
    });
    const closed = harness({ connected: ["github"], imported: null });
    const result = await run(closed.service.take({ agentId: "agent-1", text: "fix acme/shop#3" }));
    expect(result).toMatchObject({
      outcome: "failed",
      key: "acme/shop#3",
      reason: sourceText("error.agent.ticketTake.closed"),
    });
    expect(closed.created).toEqual([]);
    expect(closed.starts).toEqual([]);
  });

  it("refuses a Done ticket and a ticket already running in a thread, so it never runs twice", async () => {
    const done = harness({ tickets: [ticket({ id: "t-12", status: "done", external: GITHUB_12 })] });
    expect(await run(done.service.take({ agentId: "agent-1", text: "take acme/shop#12" }))).toMatchObject({
      outcome: "failed",
      reason: sourceText("error.agent.ticketTake.closed"),
    });
    const running = harness({
      tickets: [ticket({ id: "t-12", taskId: "task-1", status: "running", external: GITHUB_12 })],
    });
    expect(await run(running.service.take({ agentId: "agent-1", text: "take acme/shop#12" }))).toMatchObject({
      outcome: "failed",
      reason: sourceText("error.agent.ticketTake.alreadyRunning"),
    });
    expect([...done.starts, ...running.starts]).toEqual([]);
  });

  it("refuses Jira and an agent that is not on this computer", async () => {
    const { service, starts } = harness({ connected: ["jira"] });
    expect(await run(service.take({ agentId: "agent-1", text: "fix PROJ-1 in jira" }))).toMatchObject({
      outcome: "failed",
      reason: sourceText("error.agent.ticketTake.githubOnly"),
    });
    expect(await run(service.take({ agentId: "ghost", text: "fix acme/shop#1" }))).toMatchObject({ outcome: "failed" });
    expect(starts).toEqual([]);
  });

  it("answers none for a message that asks for no ticket", async () => {
    const { service } = harness({ connected: ["jira"] });
    expect(await run(service.take({ agentId: "agent-1", text: "hello there" }))).toEqual({ outcome: "none" });
  });
});

describe("ticket taken card state", () => {
  const role = (roleId: string, patch: Partial<RavenTeamJob["roles"][number]> = {}) => ({
    roleId,
    label: roleId,
    agentId: null,
    taskId: null,
    threadId: null,
    provider: "codex" as const,
    model: "gpt-6-luna",
    access: "write" as const,
    state: "waiting" as const,
    verdict: null,
    score: null,
    commit: null,
    fails: 0,
    updatedAt: "2026-10-30T04:00:00.000Z",
    ...patch,
  });

  it("follows the job from plan to review", () => {
    const working = job({ roles: [role("builder", { state: "working" }), role("reviewer")] });
    expect(ticketTakenSteps(working, false).map((step) => step.state)).toEqual(["done", "active", "pending"]);
    const built = job({
      headCommit: "abc1234",
      roles: [role("builder", { state: "reported" }), role("reviewer", { state: "working" })],
    });
    expect(ticketTakenSteps(built, false).map((step) => step.state)).toEqual(["done", "done", "active"]);
    expect(ticketTakenSteps(built, true).at(-1)).toEqual({ id: "merge", state: "pending" });
  });

  it("names the phase of the job; a stopped job needs the person", () => {
    expect(ticketTakenPhase(job())).toBe("working");
    expect(ticketTakenPhase(job({ queued: true }))).toBe("queued");
    expect(ticketTakenPhase(job({ state: "waiting-user" }))).toBe("needs-you");
    expect(ticketTakenPhase(job({ state: "stopped" }))).toBe("stopped");
  });
});
