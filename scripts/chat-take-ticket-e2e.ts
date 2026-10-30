// Checks Chat: an agent takes a ticket from a message (#200). The person writes "take this ticket in jira fix
// it" with a link or a key to an agent. Main reads the message again, finds or creates the board ticket, and
// the Autopilot engine starts its job at once, with the asking agent and thread in the decision.
//
// The real agent service, the team runtime, the Tickets board, the board sync, the engine and the take
// service run on a temporary profile, wired as application-services.ts wires them. A scripted Codex
// app-server stands in for the provider (the same script as autopilot-engine-e2e.ts), and a fake GitHub
// issue source stands in for GitHub. No model runs and no browser opens.
//
// Checks:
// 1. Not connected: a Jira key while Jira is not connected answers `connect` for Jira, and makes no ticket
//    and no job.
// 2. Taken: a GitHub issue link while GitHub is connected imports the issue into the board (linked to it)
//    and starts its job at once, also with Autopilot off. The decision names the agent, its thread and the
//    key. The board has one ticket for the issue.
// 3. Live: the job's ticket follows the job to Needs review; the card state of the job (phase and
//    checklist) reads "passed" with every step done.
// 4. Again: the same message while a job works answers `already` and starts no second job.
// 5. Stop: a second ticket's job, stopped, leaves the ticket in Needs review ("Needs you"), with the card
//    phase `stopped`.
// 6. Not open in its project: a GitHub key that the source does not list gets a new Backlog ticket linked
//    to the issue, and its job starts.
// 7. None: a message that names no ticket answers `none`.
// 8. Restart: a second runtime on the same database keeps each decision's chat (agent, thread, key).
//
// `bun scripts/chat-take-ticket-e2e.ts`. Writes .openbot-build/autopilot/chat-take-ticket-e2e.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import type { BoardTicketProvider, RavenAutopilotSettings, RavenTeamJob } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { BoardTicketSyncIssue, BoardTicketSyncSource } from "../src/backend/board-tickets/board-ticket-sync-source";

const OUT = resolve(import.meta.dirname, "../.openbot-build/autopilot");
const root = await mkdtemp(join(tmpdir(), "openbot-chat-take-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
/** The models the scripted provider lists. The names are the test's, not a real provider's. */
const MODELS = ["gpt-6-luna", "gpt-6-sol", "gpt-6-nova"];
const HEADS = [
  "1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d",
  "2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e",
  "3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f",
];
const EFFORT_MODEL = "gpt-6-sol";
const REPO = "openbot/take-e2e";

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { RavenTeamService } = await import("../src/backend/raven-team/raven-team-service");
const { RavenTeamStore } = await import("../src/backend/raven-team/raven-team-store");
const { AutopilotEngine } = await import("../src/backend/raven-team/autopilot-engine");
const { TicketTakeService } = await import("../src/backend/raven-team/ticket-take");
const { BoardTicketService } = await import("../src/backend/board-tickets/board-ticket-service");
const { BoardTicketStore } = await import("../src/backend/board-tickets/board-ticket-store");
const { BoardTicketSync } = await import("../src/backend/board-tickets/board-ticket-sync");
const { BoardTicketTeamFollower } = await import("../src/backend/board-tickets/board-ticket-team-follower");
const { defaultRavenAutopilotSettings, ticketTakenPhase, ticketTakenSteps } = await import("@openbot/contracts/ipc");

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const MODELS = ${JSON.stringify(MODELS)};
const EFFORT_MODEL = ${JSON.stringify(EFFORT_MODEL)};
const HEADS = ${JSON.stringify(HEADS)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const roleByThread = new Map();
const turnCount = new Map();
const reviewCount = new Map();
const alwaysFail = new Set();
const slow = new Set();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId, text) => {
  const item = { type: "agentMessage", id: "message-" + turnId, text, phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const scriptedReply = (threadId, text, count) => {
  const role = roleByThread.get(threadId);
  const commit = (/Review commit ([0-9a-f]{40})/.exec(text) || [])[1] || "";
  if (role === "Architect") return "Plan: change the helper.\\nRAVEN-REPORT: {\\"verdict\\":\\"DONE\\"}";
  if (role === "Builder") {
    const head = HEADS[Math.min(count - 1, HEADS.length - 1)];
    return "Built the ticket and got CI green.\\nRAVEN-REPORT: {\\"verdict\\":\\"DONE\\",\\"commit\\":\\"" + head + "\\",\\"pr\\":\\"https://github.com/openbot/autopilot-e2e/pull/7\\"}";
  }
  if (role === "Reviewer") {
    const seen = (reviewCount.get(threadId) || 0) + 1;
    reviewCount.set(threadId, seen);
    const verdict = alwaysFail.has(threadId) || seen === 1 ? "FAIL" : "PASS";
    return "Review of " + commit + ": " + verdict + ".\\nRAVEN-REPORT: {\\"verdict\\":\\"" + verdict + "\\",\\"commit\\":\\"" + commit + "\\"}";
  }
  if (role === "Quality") return "Scored " + commit + " out of 10.\\nRAVEN-REPORT: {\\"verdict\\":\\"PASS\\",\\"score\\":10,\\"commit\\":\\"" + commit + "\\"}";
  return "Done.";
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: MODELS.map((model) => ({ model, displayName: model, ...(model === EFFORT_MODEL ? { defaultReasoningEffort: "medium", supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort })) } : {}) })) } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": {
      const threadId = "thread-" + process.pid + "-" + (++threads);
      return write({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
    }
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      const label = /You are the (\\w+) of a Raven Stack team/.exec(text);
      if (label) roleByThread.set(params.threadId, label[1]);
      if (label && text.includes("SCRIPT-ALWAYS-FAIL")) alwaysFail.add(params.threadId);
      if (label && text.includes("SCRIPT-SLOW")) slow.add(params.threadId);
      const count = (turnCount.get(params.threadId) || 0) + 1;
      turnCount.set(params.threadId, count);
      log({ kind: "turn", threadId: params.threadId, turnId, model: params.model ?? null, effort: params.effort ?? null, role: roleByThread.get(params.threadId) ?? null });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const reply = scriptedReply(params.threadId, text, count);
      return setTimeout(() => finish(params.threadId, turnId, reply), slow.has(params.threadId) ? 1500 : 20);
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface Check {
  name: string;
  passed: boolean;
}

const report: {
  model: string;
  passed: boolean;
  checks: Check[];
  runs: { name: string; detail: string }[];
  unverified: string[];
  error?: string;
} = {
  model: "none. A scripted Codex app-server stands in for the provider; no model runs.",
  passed: false,
  checks: [],
  runs: [],
  unverified: [
    "A model that plans, codes or reviews. The verdicts here are scripted.",
    "A real GitHub or Jira. A fake GitHub issue source lists the open issues.",
    "The chat card in the running app. This check runs no browser and takes no screenshot.",
  ],
};

const record = (name: string, detail: object): void => {
  report.runs.push({ name, detail: JSON.stringify(detail) });
};

function check(name: string, condition: boolean, detail?: string): void {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

/** Waits for a state. A timeout names the state it waited for. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Autopilot stays off: a ticket from a chat starts at once all the same. */
const settings: RavenAutopilotSettings = { ...defaultRavenAutopilotSettings(), enabled: false };
/** The ticket systems that count as connected. */
let connected: BoardTicketProvider[] = [];

/** The open issues of the fake GitHub repository. */
const ISSUES: BoardTicketSyncIssue[] = [
  {
    key: `${REPO}#12`,
    title: "Checkout fails when the cart has a coupon",
    body: "Steps to reproduce: add a coupon. Expected: the total. Actual: an error.",
    url: `https://github.com/${REPO}/issues/12`,
    labels: ["bug"],
  },
  {
    key: `${REPO}#13`,
    title: "Add a dark mode toggle",
    body: "Add the toggle in src/settings/Appearance.tsx. SCRIPT-SLOW",
    url: `https://github.com/${REPO}/issues/13`,
    labels: ["feature"],
  },
];
const fakeGitHubSource: BoardTicketSyncSource = {
  projects: () => Effect.succeed([REPO]),
  isProject: (project) => /^[\w.-]+\/[\w.-]+$/u.test(project),
  openIssues: (project) => Effect.succeed(project === REPO ? ISSUES : []),
  comment: () => Effect.void,
  move: () => Effect.void,
};

async function startRuntime() {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  });
  let engine: InstanceType<typeof AutopilotEngine> | null = null;
  const boardStore = new BoardTicketStore(database);
  const board = new BoardTicketService({ store: boardStore, changed: () => engine?.wake() });
  const sync = new BoardTicketSync({
    store: boardStore,
    board,
    sources: { github: fakeGitHubSource },
    connected: () => connected,
    changed: () => {},
  });
  const follower = new BoardTicketTeamFollower(board);
  const team: InstanceType<typeof RavenTeamService> = new RavenTeamService({
    store: new RavenTeamStore(database),
    agents,
    changed: (jobId) => {
      const job = jobId === null ? null : team.job(jobId);
      if (!job) return;
      follower.follow(job);
      engine?.noticeJob(job);
    },
    platform: "linux",
    workspaceOnlySupported: () => true,
  });
  agents.on("turn", (event) => Effect.runFork(team.notice(event)));
  agents.on("event", (event) => {
    if (event.type === "agents-changed" || event.type === "error") Effect.runFork(team.notice(event));
    if (event.type === "agent-tasks-changed") engine?.noticeTasks(event.snapshot);
  });
  engine = new AutopilotEngine({
    board,
    team,
    agents: {
      listModels: () => agents.listModels(),
      preferredProvider: () => agents.preferredProvider(),
      listAgents: () => agents.listAgents(),
    },
    settings: () => settings,
    repo: () => REPO,
  });
  const started = engine;
  const take = new TicketTakeService({
    board,
    sync: {
      connected: () => sync.state().providers,
      importIssueByKey: (provider, key) => sync.importIssueByKey(provider, key),
    },
    take: (ticketId, chat) => started.takeNow(ticketId, chat),
    agentThread: (agentId) => {
      const agent = store.list().find((candidate) => candidate.id === agentId);
      return agent ? (agent.threadId ?? null) : undefined;
    },
  });
  await runCauseEffect(agents.initialize());
  return {
    database,
    store,
    agents,
    board,
    team,
    engine: started,
    take,
    async stop() {
      started.stop();
      await runCauseEffect(agents.stop());
      database.close();
    },
  };
}

type Runtime = Awaited<ReturnType<typeof startRuntime>>;

const jobById = (runtime: Runtime, jobId: string): RavenTeamJob | null => runtime.team.job(jobId);

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
let runtime: Runtime | null = null;

try {
  runtime = await startRuntime();
  const first = runtime;
  // The agent whose chat the messages are in.
  const asker = await runCauseEffect(
    first.agents.createAgent({
      name: "Debugging Partner",
      description: "The agent of the chat.",
      avatarSeed: "debugging-partner",
      avatarHue: null,
      initialMessage: "Hi.",
      provider: "codex",
      model: MODELS[0] ?? "gpt-6-luna",
    }),
  );
  const askerThread = first.store.list().find((agent) => agent.id === asker.id)?.threadId ?? null;

  // 1. Not connected.
  const ticketsBefore = first.board.list().length;
  const notConnected = await runCauseEffect(
    first.take.take({ agentId: asker.id, text: "take this ticket in jira fix it PROJ-482" }),
  );
  record("not connected", notConnected);
  check("a Jira key without Jira asks to connect Jira", notConnected.outcome === "connect" && notConnected.provider === "jira");
  check("the connect answer makes no ticket", first.board.list().length === ticketsBefore);
  check("the connect answer starts no job", first.team.listJobs().length === 0);

  // 2. Taken from a GitHub link, with Autopilot off.
  connected = ["github"];
  const taken = await runCauseEffect(
    first.take.take({ agentId: asker.id, text: `please fix https://github.com/${REPO}/issues/12` }),
  );
  record("taken", taken);
  check("the GitHub link is taken", taken.outcome === "taken" && !taken.already);
  if (taken.outcome !== "taken") throw new Error("The ticket was not taken.");
  const ticket = first.board.get(taken.ticketId);
  check("the ticket is linked to the issue", ticket?.external?.key === `${REPO}#12`);
  check(
    "the board has one ticket for the issue",
    first.board.list().filter((candidate) => candidate.external?.key === `${REPO}#12`).length === 1,
  );
  const job = jobById(first, taken.jobId);
  check("the job started at once, with Autopilot off", job !== null);
  check("the decision is for the ticket", job?.decision?.ticketId === taken.ticketId);
  check(
    "the decision names the agent, its thread and the key",
    job?.decision?.chat?.agentId === asker.id &&
      job.decision.chat.threadId === askerThread &&
      job.decision.chat.ticketKey === `${REPO}#12`,
  );
  check("the decision has a stack and a reason", Boolean(job?.decision?.stack && job.decision.reason));

  // 3. Live: the ticket follows the job to Needs review, and the card state reads it.
  const passed = await waitFor("the taken job passes", () => {
    const current = jobById(first, taken.jobId);
    return current?.state === "done" ? current : null;
  });
  check("the job's ticket is in Needs review", first.board.get(taken.ticketId)?.status === "needs_review");
  check("the card phase is passed", ticketTakenPhase(passed) === "passed");
  check(
    "every step of the card is done",
    ticketTakenSteps(passed, false).every((step) => step.state === "done"),
    JSON.stringify(ticketTakenSteps(passed, false)),
  );
  check("one board ticket for the job, roles aside", first.board.forTeamJob(taken.jobId).filter((t) => t.teamRoleId === null).length === 1);

  // 4 and 5. A slow second ticket: the same message again answers `already`; Stop leaves it in Needs you.
  const slowText = `work on https://github.com/${REPO}/issues/13`;
  const slow = await runCauseEffect(first.take.take({ agentId: asker.id, text: slowText }));
  if (slow.outcome !== "taken") throw new Error("The slow ticket was not taken.");
  await waitFor("the slow job runs", () => jobById(first, slow.jobId)?.state === "running");
  const jobsBefore = first.team.listJobs().length;
  const again = await runCauseEffect(first.take.take({ agentId: asker.id, text: slowText }));
  record("again", again);
  check("the same message again answers already", again.outcome === "taken" && again.already && again.jobId === slow.jobId);
  check("the same message again starts no second job", first.team.listJobs().length === jobsBefore);
  await runCauseEffect(first.team.stop(slow.jobId));
  const stopped = await waitFor("the slow ticket in Needs review", () => {
    const current = first.board.get(slow.ticketId);
    return current?.status === "needs_review" ? current : null;
  });
  const stoppedJob = jobById(first, slow.jobId);
  check("Stop stops the job", stoppedJob?.state === "stopped");
  check("Stop leaves the ticket in Needs you", stopped.status === "needs_review");
  check("the card phase is stopped", stoppedJob !== null && ticketTakenPhase(stoppedJob) === "stopped");

  // 6. Not open in its project: a new linked Backlog ticket, and its job.
  const missing = await runCauseEffect(first.take.take({ agentId: asker.id, text: `fix ${REPO}#99 please` }));
  record("not open", missing);
  check("a key the source does not list is taken", missing.outcome === "taken");
  if (missing.outcome === "taken") {
    const made = first.board.get(missing.ticketId);
    check("the new ticket links the issue", made?.external?.url === `https://github.com/${REPO}/issues/99`);
    check("the new ticket is a Bug from the fix request", made?.type === "bug");
  }

  // 7. None.
  const none = await runCauseEffect(first.take.take({ agentId: asker.id, text: "thanks, that is all" }));
  check("a message with no ticket answers none", none.outcome === "none");

  // 8. Restart.
  const chats = first.team
    .listJobs()
    .map((candidate) => [candidate.id, JSON.stringify(candidate.decision?.chat ?? null)] as const);
  await first.stop();
  runtime = null;
  runtime = await startRuntime();
  const second = runtime;
  check(
    "the restart keeps each decision's chat",
    chats.every(([jobId, chat]) => JSON.stringify(second.team.job(jobId)?.decision?.chat ?? null) === chat),
  );

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (runtime) {
    const current = runtime;
    record("state at the failure", {
      tickets: current.board.list().map((candidate) => ({
        title: candidate.title,
        status: candidate.status,
        external: candidate.external?.key ?? null,
        teamJobId: candidate.teamJobId,
      })),
      jobs: current.team.listJobs().map((candidate) => ({
        id: candidate.id,
        state: candidate.state,
        ticketId: candidate.decision?.ticketId ?? null,
        chat: candidate.decision?.chat ?? null,
      })),
    });
  }
  process.exitCode = 1;
} finally {
  if (runtime) await runtime.stop().catch(() => undefined);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "chat-take-ticket-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

process.stdout.write(`chat take ticket e2e: ${report.passed ? "passed" : "failed"} (${report.checks.length} checks)\n`);
if (!report.passed) process.stderr.write(`${report.error}\n`);
process.exit(process.exitCode ?? 0);
