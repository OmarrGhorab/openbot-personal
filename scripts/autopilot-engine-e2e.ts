// Checks the Autopilot engine (#196): Raven takes Backlog tickets, decides the stack, the team and a model
// for each role, runs the team job until the review passes, and moves the ticket to Needs review.
//
// The real agent service, the team runtime, the Tickets board and the engine run on a temporary profile.
// A scripted Codex app-server stands in for the provider (the same script as raven-team-e2e.ts): the
// Architect plans, the Builder reports a commit, the Reviewer fails the first head and passes the next,
// and Quality scores 10. A brief with SCRIPT-ALWAYS-FAIL makes the Reviewer fail every round, and one with
// SCRIPT-SLOW makes each turn of the job slow, so the check can see two jobs at work at once. No model
// runs, so this check shows what the engine does with the board and the reports; it does not show how a
// model decides or codes.
//
// Checks:
// 1. Backlog → Needs review: with Autopilot on, a typed Backlog ticket starts a team job whose decision
//    (stack, template, a model per role, reason code and sentence) is stored on the job; the job's ticket
//    is the Backlog ticket (no second ticket), and it moves to Needs review with a "passed" note.
// 2. Two slots: with three ready tickets and "tickets at once" 2, two jobs run and the third waits in
//    Backlog; it starts when a slot frees.
// 3. A ticket with no type that the text does not give stays in Backlog with one note, and is not taken.
// 4. Restart: a second runtime on the same database reads the jobs with their decisions, starts no
//    second job for a ticket that has one, and does not write the same note again.
// 5. Round limit: with a round limit of 1 and a Reviewer that always fails, the job ends not done and
//    the ticket gets the round-limit note.
//
// `bun scripts/autopilot-engine-e2e.ts`. Writes .openbot-build/autopilot/autopilot-engine-e2e.json.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import type { BoardTicket, RavenAutopilotSettings, RavenTeamJob } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/autopilot");
const root = await mkdtemp(join(tmpdir(), "openbot-autopilot-engine-"));
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
const { BoardTicketService } = await import("../src/backend/board-tickets/board-ticket-service");
const { BoardTicketStore } = await import("../src/backend/board-tickets/board-ticket-store");
const { BoardTicketTeamFollower } = await import("../src/backend/board-tickets/board-ticket-team-follower");
const { defaultRavenAutopilotSettings } = await import("@openbot/contracts/ipc");

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
    return "Built the ticket and got CI green.\\nRAVEN-REPORT: {\\"verdict\\":\\"DONE\\",\\"commit\\":\\"" + head + "\\"}";
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
    "The pause on a usage limit. The scripted provider has no usage limit to report.",
    "The Tickets drawer and the Autopilot tab in the running app. Not run in this check.",
    "A pull request, CI and a merge. Merge belongs to #198.",
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

function turnCount(): number {
  try {
    return readFileSync(fakeLog, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** The Autopilot settings of the check. Read by the engine at each pick-up, so a change applies at once. */
let settings: RavenAutopilotSettings = { ...defaultRavenAutopilotSettings(), enabled: true, ticketsAtOnce: 2 };

/**
 * One app runtime on the profile: the agent service, the team, the board, the follower and the engine,
 * wired as application-services.ts wires them. A second call on the same folder is a restart.
 */
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
  const board = new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => engine?.wake(),
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
    repo: () => "openbot/autopilot-e2e",
  });
  await runCauseEffect(agents.initialize());
  const started = engine;
  return {
    database,
    agents,
    board,
    team,
    engine: started,
    async stop() {
      started.stop();
      await runCauseEffect(agents.stop());
      database.close();
    },
  };
}

type Runtime = Awaited<ReturnType<typeof startRuntime>>;

const jobOf = (runtime: Runtime, ticketId: string): RavenTeamJob | undefined =>
  runtime.team.listJobs().find((job) => job.decision?.ticketId === ticketId);
const ticketOf = (runtime: Runtime, ticketId: string): BoardTicket | null => runtime.board.get(ticketId);
const notes = (runtime: Runtime, ticketId: string): string[] =>
  runtime.board
    .events(ticketId)
    .filter((event) => event.kind === "comment")
    .map((event) => event.text ?? "");
const runningAutopilotJobs = (runtime: Runtime): RavenTeamJob[] =>
  runtime.team.listJobs().filter((job) => job.decision && job.state === "running");

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
let runtime: Runtime | null = null;
let maxRunning = 0;

try {
  // Autopilot is off while the board is filled, so no pick-up happens between two creates.
  settings = { ...settings, enabled: false };
  runtime = await startRuntime();
  const first = runtime;
  const untyped = first.board.create({ title: "Think about it", body: "" });
  const feature = first.board.create({
    title: "Add a dark mode toggle to settings",
    body: "Add the toggle in src/settings/Appearance.tsx. SCRIPT-SLOW",
    type: "feature",
  });
  const bug = first.board.create({
    title: "Login fails when the email has a plus sign",
    body: "Steps to reproduce: sign in with a+b@example.com. Expected: signed in. Actual: error. SCRIPT-SLOW",
    type: "bug",
  });
  const chore = first.board.create({ title: "Update the README badges", body: "README.md only.", type: "chore" });
  check("the untyped ticket has no type", untyped.type === null, String(untyped.type));

  // 1-3. Two slots: the feature and the bug start, the chore waits, the untyped ticket gets a note.
  settings = { ...settings, enabled: true };
  await runCauseEffect(first.engine.start());
  await waitFor("two Autopilot jobs", () => runningAutopilotJobs(first).length === 2);
  const sampler = setInterval(() => {
    maxRunning = Math.max(maxRunning, runningAutopilotJobs(first).length);
  }, 20);
  check("the feature ticket started a job", Boolean(jobOf(first, feature.id)));
  check("the bug ticket started a job", Boolean(jobOf(first, bug.id)));
  check("the chore waits in Backlog while both slots are taken", ticketOf(first, chore.id)?.status === "backlog");
  check("the engine counts two running and one waiting", first.engine.status().running === 2);
  check("the untyped ticket stays in Backlog", ticketOf(first, untyped.id)?.status === "backlog");
  check(
    "the untyped ticket has the no-type note once",
    notes(first, untyped.id).filter((text) => text === sourceText("error.agent.autopilot.noType")).length === 1,
  );
  check("the untyped ticket has no job", !jobOf(first, untyped.id));

  const featureJob = jobOf(first, feature.id);
  const decision = featureJob?.decision;
  record("feature decision", decision ?? {});
  check("the decision names a stack and a template", Boolean(decision?.stack && decision.templateId));
  check("the decision has a model for each role", (decision?.roles.length ?? 0) > 0 && decision?.roles.every((role) => role.model) === true);
  check("the decision has a reason code and its sentence", Boolean(decision?.reasonCode && decision.reason));
  check("the decision keeps the repository", decision?.repo === "openbot/autopilot-e2e");
  check(
    "the job's ticket is the Backlog ticket, not a second one",
    first.board.list().filter((ticket) => ticket.teamJobId === featureJob?.id && ticket.teamRoleId === null).length === 1 &&
      ticketOf(first, feature.id)?.teamJobId === featureJob?.id,
  );

  // 1. Backlog → Needs review with the passed note.
  await waitFor("the feature job done", () => jobOf(first, feature.id)?.state === "done");
  await waitFor("the feature ticket in Needs review", () => ticketOf(first, feature.id)?.status === "needs_review");
  check("the feature ticket moved to Needs review", ticketOf(first, feature.id)?.status === "needs_review");
  check("the feature ticket has the passed note", notes(first, feature.id).includes(sourceText("error.agent.autopilot.passed")));
  record("feature ticket times", ticketOf(first, feature.id)?.statusTimes ?? {});

  // 2. The freed slot takes the chore.
  await waitFor("the chore job", () => jobOf(first, chore.id));
  await waitFor("every job done", () => [feature, bug, chore].every((ticket) => jobOf(first, ticket.id)?.state === "done"));
  clearInterval(sampler);
  check("never more than two Autopilot jobs ran at once", maxRunning <= 2, String(maxRunning));
  check("the chore ran on Autopilot lite or its own stack", Boolean(jobOf(first, chore.id)?.decision?.reasonCode));
  const decisionsBefore = Object.fromEntries(
    first.team.listJobs().flatMap((job) => (job.decision?.ticketId ? [[job.decision.ticketId, job.decision]] : [])),
  );
  const jobsBefore = first.team.listJobs().length;
  const untypedNotes = notes(first, untyped.id).length;
  record("jobs before the restart", { jobs: jobsBefore, turns: turnCount() });

  // 4. Restart on the same database.
  await first.stop();
  runtime = null;
  const second = await startRuntime();
  runtime = second;
  await runCauseEffect(second.engine.start());
  await new Promise((done) => setTimeout(done, 500));
  check("the restart keeps every job", second.team.listJobs().length === jobsBefore);
  check(
    "the restart reads each decision back as it was stored",
    Object.entries(decisionsBefore).every(([ticketId, stored]) => {
      const read = jobOf(second, ticketId)?.decision;
      return JSON.stringify(read) === JSON.stringify(stored);
    }),
  );
  check("the restart starts no second job for a ticket", second.team.listJobs().length === jobsBefore);
  check("the restart does not write the no-type note again", notes(second, untyped.id).length === untypedNotes);
  check("the tickets keep their columns after the restart", ticketOf(second, feature.id)?.status === "needs_review");

  // 5. Round limit: one round, and a Reviewer that always fails.
  settings = { ...settings, roundCap: 1 };
  const stuck = second.board.create({
    title: "Add an export button",
    body: "Add it in src/export/Button.tsx. SCRIPT-ALWAYS-FAIL",
    type: "feature",
  });
  await waitFor("the stuck job", () => jobOf(second, stuck.id));
  check("the stuck job carries the round limit of the settings", jobOf(second, stuck.id)?.roundCap === 1);
  await waitFor("the stuck job not done", () => jobOf(second, stuck.id)?.state === "not-done", 120_000);
  await waitFor("the round-limit note", () =>
    notes(second, stuck.id).includes(sourceText("error.agent.autopilot.roundLimit", { rounds: 1 })),
  );
  check("the stuck ticket has the round-limit note", true);
  record("stuck job", { state: jobOf(second, stuck.id)?.state, switches: jobOf(second, stuck.id)?.decision?.switches ?? [] });
  record("stuck ticket", { status: ticketOf(second, stuck.id)?.status, error: ticketOf(second, stuck.id)?.error });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (runtime) {
    const current = runtime;
    record("state at the failure", {
      tickets: current.board.list().map((ticket) => ({
        title: ticket.title,
        status: ticket.status,
        type: ticket.type,
        teamJobId: ticket.teamJobId,
        notes: notes(current, ticket.id),
      })),
      jobs: current.team.listJobs().map((job) => ({
        id: job.id,
        state: job.state,
        queued: job.queued,
        ticketId: job.decision?.ticketId ?? null,
        roles: job.roles.map((role) => ({ roleId: role.roleId, state: role.state, verdict: role.verdict })),
      })),
      engine: current.engine.status(),
    });
  }
  process.exitCode = 1;
} finally {
  if (runtime) await runtime.stop().catch(() => undefined);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "autopilot-engine-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

process.stdout.write(`autopilot engine e2e: ${report.passed ? "passed" : "failed"} (${report.checks.length} checks)\n`);
if (!report.passed) process.stderr.write(`${report.error}\n`);
process.exit(process.exitCode ?? 0);
