import {
  type BoardTicket,
  type BoardTicketProvider,
  detectTicketTakeRequest,
  type RavenAutopilotChat,
  type RavenTeamJob,
  ticketTakenPhase,
  ticketTakenSteps,
} from "@openbot/contracts/ipc";
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
  const takes: { ticketId: string; chat: RavenAutopilotChat }[] = [];
  const service = new TicketTakeService({
    board: {
      list: () => tickets,
      get: (id) => tickets.find((candidate) => candidate.id === id) ?? null,
      create: (input, _actor, links) => {
        const made = ticket({
          id: `new-${created.length + 1}`,
          title: input.title,
          body: input.body ?? "",
          type: input.type ?? null,
          external: links?.external ?? null,
        });
        created.push(made);
        tickets.push(made);
        return made;
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
    take: (ticketId, chat) =>
      Effect.sync(() => {
        takes.push({ ticketId, chat });
        return { job: job(), already: false };
      }),
    agentThread: (agentId) => (agentId === "agent-1" ? "thread-1" : undefined),
  });
  return { service, created, takes };
}

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

describe("TicketTakeService", () => {
  it("asks to connect a system that is not connected", async () => {
    const { service, takes } = harness({});
    const result = await run(service.take({ agentId: "agent-1", text: "take this ticket in jira fix it PROJ-482" }));
    expect(result).toEqual({ outcome: "connect", key: "PROJ-482", provider: "jira" });
    expect(takes).toEqual([]);
  });

  it("uses the board ticket of the issue, also without a connection", async () => {
    const onBoard = ticket({
      external: { provider: "jira", key: "PROJ-482", url: "https://acme.atlassian.net/browse/PROJ-482" },
    });
    const { service, takes } = harness({ tickets: [onBoard] });
    const result = await run(service.take({ agentId: "agent-1", text: "fix proj-482 in jira" }));
    expect(result).toMatchObject({ outcome: "none" });
    const taken = await run(service.take({ agentId: "agent-1", text: "fix PROJ-482 in jira" }));
    expect(taken).toEqual({
      outcome: "taken",
      jobId: "job-1",
      ticketId: onBoard.id,
      key: "PROJ-482",
      provider: "jira",
      already: false,
    });
    expect(takes).toEqual([
      { ticketId: onBoard.id, chat: { agentId: "agent-1", threadId: "thread-1", ticketKey: "PROJ-482" } },
    ]);
  });

  it("imports the issue when its system is connected", async () => {
    const imported = ticket({
      id: "synced",
      external: { provider: "github", key: "acme/shop#12", url: "https://github.com/acme/shop/issues/12" },
    });
    const { service, created } = harness({ connected: ["github"], imported });
    const result = await run(
      service.take({ agentId: "agent-1", text: "work on https://github.com/acme/shop/issues/12" }),
    );
    expect(result).toMatchObject({ outcome: "taken", ticketId: "synced" });
    expect(created).toEqual([]);
  });

  it("creates a linked Backlog ticket when the issue is not open in its project", async () => {
    const { service, created } = harness({ connected: ["github"], imported: null });
    const result = await run(service.take({ agentId: "agent-1", text: "fix acme/shop#3" }));
    expect(result).toMatchObject({ outcome: "taken", ticketId: "new-1", key: "acme/shop#3" });
    expect(created[0]?.external).toEqual({
      provider: "github",
      key: "acme/shop#3",
      url: "https://github.com/acme/shop/issues/3",
    });
    expect(created[0]?.type).toBe("bug");
  });

  it("refuses an agent that is not on this computer", async () => {
    const { service, takes } = harness({ connected: ["jira"] });
    const result = await run(service.take({ agentId: "ghost", text: "fix PROJ-1 in jira" }));
    expect(result).toMatchObject({ outcome: "failed", key: "PROJ-1" });
    expect(takes).toEqual([]);
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
