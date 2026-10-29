// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardTicketProvider, BoardTicketStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { GitHubTicketSource } from "../agent-tickets/github-ticket-source";
import { TicketSourceFailed } from "../agent-tickets/ticket-source";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";
import { BoardTicketSync } from "./board-ticket-sync";
import type { BoardTicketSyncIssue, BoardTicketSyncSource } from "./board-ticket-sync-source";
import { GitHubBoardSyncSource } from "./github-board-sync-source";

// Failure modes: a board with no ticket system connected calls one anyway, or shows a sync it cannot do;
// a second import copies every issue again; an issue's new title never reaches its ticket; a move to Done
// or an agent comment never reaches the issue; the person's message to the work thread is posted on a
// public issue; the sync's own import is sent back to the issue; a failed push is silent; a lost
// connection deletes the imported tickets or keeps sending; a failed read empties the board; a typo in
// the repository reaches the ticket system; GitHub's issue is not closed on Done or not opened again.
const roots: string[] = [];
const syncs: BoardTicketSync[] = [];
afterEach(async () => {
  for (const sync of syncs.splice(0)) await sync.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A connected ticket system with one repository. It records each call, and fails while it is down. */
class FakeSource implements BoardTicketSyncSource {
  issues: BoardTicketSyncIssue[] = [];
  down = false;
  readonly calls: string[] = [];

  projects(): Effect.Effect<string[], TicketSourceFailed> {
    return Effect.succeed(["octo/app"]);
  }

  isProject(project: string): boolean {
    return /^[\w.-]+\/[\w.-]+$/u.test(project);
  }

  openIssues(project: string): Effect.Effect<BoardTicketSyncIssue[], TicketSourceFailed> {
    this.calls.push(`list ${project}`);
    return this.down ? this.#fail() : Effect.succeed(this.issues.map((issue) => ({ ...issue })));
  }

  comment(key: string, text: string): Effect.Effect<void, TicketSourceFailed> {
    this.calls.push(`comment ${key} ${text}`);
    return this.down ? this.#fail() : Effect.void;
  }

  move(key: string, from: BoardTicketStatus, to: BoardTicketStatus): Effect.Effect<void, TicketSourceFailed> {
    this.calls.push(`move ${key} ${from} ${to}`);
    return this.down ? this.#fail() : Effect.void;
  }

  #fail(): Effect.Effect<never, TicketSourceFailed> {
    return Effect.fail(new TicketSourceFailed({ cause: new Error("The ticket system is down.") }));
  }
}

const LOGIN_ISSUE: BoardTicketSyncIssue = {
  key: "octo/app#1",
  title: "Fix the login timeout",
  body: "Sessions end after 5 minutes.",
  url: "https://github.com/octo/app/issues/1",
};
const DOCS_ISSUE: BoardTicketSyncIssue = {
  key: "octo/app#2",
  title: "Write the release notes",
  body: "",
  url: "https://github.com/octo/app/issues/2",
};

async function harness(connected: BoardTicketProvider[] = ["github"]) {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-sync-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const store = new BoardTicketStore(database);
  const board = new BoardTicketService({ store, changed: () => undefined });
  const source = new FakeSource();
  const connection = { providers: connected };
  const sync = new BoardTicketSync({
    store,
    board,
    sources: { github: source },
    connected: () => connection.providers,
    changed: () => undefined,
    intervalMs: 60 * 60 * 1000,
  });
  sync.start();
  syncs.push(sync);
  const target = () => runCauseEffect(sync.setTarget({ provider: "github", project: "octo/app" }));
  const syncNow = () => runCauseEffect(sync.syncNow());
  return { board, source, sync, connection, target, syncNow };
}

function ticketOf(board: BoardTicketService, key: string) {
  const ticket = board.list().find((candidate) => candidate.external?.key === key);
  if (!ticket) throw new Error(`No ticket for ${key}.`);
  return ticket;
}

describe("board ticket sync", () => {
  it("shows no sync and makes no call while no ticket system is connected", async () => {
    const { board, source, sync, target, syncNow } = await harness([]);

    expect(sync.state()).toEqual({ providers: [], target: null, lastSyncedAt: null, error: null });
    await expect(target()).rejects.toThrow(sourceText("error.agent.boardTickets.syncNotConnected"));
    await expect(runCauseEffect(sync.projects("github"))).rejects.toThrow(
      sourceText("error.agent.boardTickets.syncNotConnected"),
    );
    await syncNow();

    expect(board.list()).toEqual([]);
    expect(source.calls).toEqual([]);
  });

  it("imports the open issues into Backlog once, linked to their issues, and takes a new title", async () => {
    const { board, source, target, syncNow } = await harness();
    source.issues = [LOGIN_ISSUE, DOCS_ISSUE];

    const state = await target();

    expect(state.target).toEqual({ provider: "github", project: "octo/app" });
    expect(state.lastSyncedAt).not.toBeNull();
    expect(board.list().map((ticket) => [ticket.title, ticket.status, ticket.agentId, ticket.external])).toEqual([
      ["Fix the login timeout", "backlog", null, { provider: "github", key: LOGIN_ISSUE.key, url: LOGIN_ISSUE.url }],
      ["Write the release notes", "backlog", null, { provider: "github", key: DOCS_ISSUE.key, url: DOCS_ISSUE.url }],
    ]);
    const login = ticketOf(board, LOGIN_ISSUE.key);
    expect(board.events(login.id).map((event) => [event.kind, event.actor])).toEqual([["created", "sync"]]);

    board.move({ ticketId: login.id, status: "running" });
    source.issues = [{ ...LOGIN_ISSUE, title: "Fix the login timeout on Safari" }, DOCS_ISSUE];
    const again = await syncNow();

    expect(again.error).toBeNull();
    expect(board.list()).toHaveLength(2);
    expect(ticketOf(board, LOGIN_ISSUE.key)).toMatchObject({
      title: "Fix the login timeout on Safari",
      status: "running",
    });
  });

  it("sends moves and agent comments of a linked ticket to its issue, and keeps the rest on this computer", async () => {
    const { board, source, sync, target } = await harness();
    source.issues = [LOGIN_ISSUE];
    await target();
    const login = ticketOf(board, LOGIN_ISSUE.key);
    const local = board.create({ title: "Clean up old logs" });
    source.calls.length = 0;

    board.move({ ticketId: login.id, status: "done" });
    board.comment({ ticketId: login.id, text: "Fixed in the session code." }, "agent");
    board.comment({ ticketId: login.id, text: "Keep the old session API." }, "user");
    board.move({ ticketId: login.id, status: "done" });
    board.move({ ticketId: local.id, status: "done" });
    board.comment({ ticketId: local.id, text: "Done." }, "agent");
    await sync.whenPushed();

    expect(source.calls).toEqual([
      `move ${LOGIN_ISSUE.key} backlog done`,
      `comment ${LOGIN_ISSUE.key} Fixed in the session code.`,
    ]);
  });

  it("marks a failed push on the ticket and clears it after the next push works", async () => {
    const { board, source, sync, target } = await harness();
    source.issues = [LOGIN_ISSUE];
    await target();
    const login = ticketOf(board, LOGIN_ISSUE.key);

    source.down = true;
    board.move({ ticketId: login.id, status: "done" });
    await sync.whenPushed();
    expect(board.get(login.id)?.error).toBe(sourceText("error.agent.boardTickets.pushFailed"));

    source.down = false;
    board.move({ ticketId: login.id, status: "needs_review" });
    await sync.whenPushed();
    expect(board.get(login.id)?.error).toBeNull();
  });

  it("stops the sync and keeps every ticket when the connection goes, and resumes when it comes back", async () => {
    const { board, source, sync, connection, target, syncNow } = await harness();
    source.issues = [LOGIN_ISSUE, DOCS_ISSUE];
    await target();
    const login = ticketOf(board, LOGIN_ISSUE.key);
    source.calls.length = 0;

    connection.providers = [];
    expect(sync.state()).toMatchObject({ providers: [], target: null });
    board.move({ ticketId: login.id, status: "done" });
    await sync.whenPushed();
    await syncNow();
    expect(source.calls).toEqual([]);
    expect(board.list()).toHaveLength(2);

    connection.providers = ["github"];
    expect(sync.state().target).toEqual({ provider: "github", project: "octo/app" });
    await syncNow();
    expect(source.calls).toEqual(["list octo/app"]);
  });

  it("reports a failed read and leaves the board as it was", async () => {
    const { board, source, target, syncNow } = await harness();
    source.issues = [LOGIN_ISSUE];
    await target();

    source.down = true;
    const state = await syncNow();

    expect(state.error).toBe(sourceText("error.agent.boardTickets.syncFailed"));
    expect(board.list()).toHaveLength(1);
    source.down = false;
    expect((await syncNow()).error).toBeNull();
  });

  it("refuses a project that the ticket system does not name that way, and stops on request", async () => {
    const { board, source, sync, target } = await harness();

    await expect(runCauseEffect(sync.setTarget({ provider: "github", project: "not a repository" }))).rejects.toThrow(
      sourceText("error.agent.boardTickets.syncProjectInvalid"),
    );
    expect(sync.state().target).toBeNull();
    expect(source.calls).toEqual([]);

    source.issues = [LOGIN_ISSUE];
    await target();
    const stopped = await runCauseEffect(sync.setTarget(null));
    expect(stopped).toMatchObject({ providers: ["github"], target: null, lastSyncedAt: null });
    expect(board.list()).toHaveLength(1);
  });

  it("closes the GitHub issue on Done, opens it again when the ticket leaves Done, and skips pull requests", async () => {
    const requests: { method: string; url: string; body: string | null }[] = [];
    const issues = new GitHubTicketSource({
      accessToken: () => Effect.succeed("token"),
      apiUrl: "https://github.test",
      fetch: async (url, init) => {
        const method = init.method ?? "GET";
        requests.push({ method, url, body: typeof init.body === "string" ? init.body : null });
        if (method !== "GET") return new Response("{}", { status: 200 });
        return new Response(
          JSON.stringify([
            { number: 1, title: "Fix the login timeout", body: null, html_url: "https://github.com/Octo/App/issues/1" },
            {
              number: 2,
              title: "A pull request",
              body: "",
              html_url: "https://github.com/Octo/App/pull/2",
              pull_request: {},
            },
          ]),
          { status: 200 },
        );
      },
    });
    const source = new GitHubBoardSyncSource({ issues, repositories: () => Effect.succeed(["Octo/App"]) });

    const open = await runCauseEffect(source.openIssues("Octo/App"));
    await runCauseEffect(source.move("octo/app#1", "needs_review", "done"));
    await runCauseEffect(source.move("octo/app#1", "done", "backlog"));
    await runCauseEffect(source.move("octo/app#1", "backlog", "running"));

    expect(open).toEqual([
      {
        provider: "github",
        key: "octo/app#1",
        title: "Fix the login timeout",
        body: "",
        url: "https://github.com/Octo/App/issues/1",
      },
    ]);
    expect(requests).toEqual([
      { method: "GET", url: "https://github.test/repos/Octo/App/issues?state=open&per_page=50", body: null },
      {
        method: "PATCH",
        url: "https://github.test/repos/octo/app/issues/1",
        body: JSON.stringify({ state: "closed" }),
      },
      { method: "PATCH", url: "https://github.test/repos/octo/app/issues/1", body: JSON.stringify({ state: "open" }) },
    ]);
    expect(source.isProject("Octo/App")).toBe(true);
    expect(source.isProject("Octo App")).toBe(false);
  });
});
