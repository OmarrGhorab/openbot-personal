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
// 6. pstack missing (#197): while `pstack-tdd` is not installed, the Bug with a failing case runs Autopilot
//    lite, its decision has the `pstack-missing` reason, and the ticket has the note that names the skill.
// 7. pstack · tdd (#197): with `pstack-tdd` installed, a Bug with a failing case starts a pstack job: stack
//    `pstack`, playbook `tdd`, only a Builder and a Reviewer. The Builder's first message names
//    `$pstack-tdd` and not the Raven Stack build skills, and the job passes the review.
// 8. Reviewer merge (#198), with a fake GitHub that records each merge:
//    - with "Reviewer can merge" off, a passed job waits in Needs review and nothing merges;
//    - with it on for Features and CI green, the passed head merges once with squash and the head as
//      precondition, the ticket moves to Done with the merged note, and `onTicketMerged` fires once;
//    - when the pull request head is not the commit that passed, nothing merges, the decision records
//      `new-commit` and the ticket stays in Needs review with the note;
//    - after the setting is turned off again, the next passed job does not merge.
//
// `bun scripts/autopilot-engine-e2e.ts`. Writes .openbot-build/autopilot/autopilot-engine-e2e.json.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import type { BoardTicket, RavenAutopilotSettings, RavenTeamJob, RavenTicketMerged } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { PullRequestMerger } from "../src/backend/raven-team/github-pull-request-merger";

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
    "The pause on a usage limit. The scripted provider has no usage limit to report.",
    "The Tickets drawer and the Autopilot tab in the running app. Not run in this check.",
    "A real GitHub pull request, CI and merge. Check 8 uses a fake GitHub that records each merge.",
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
/** The fake GitHub of the Reviewer merge (#198): what `read` answers, and each merge it was asked for. */
const fakeGitHub: {
  /** `match`: the pull request head is the head of the job of `ticketId`. `moved`: it is another commit. */
  head: "match" | "moved";
  ticketId: string | null;
  merges: { number: number; sha: string; method: string }[];
} = { head: "match", ticketId: null, merges: [] };
const mergedEvents: RavenTicketMerged[] = [];
/** Whether the `pstack-tdd` skill counts as installed. The engine reads it at each pick-up (#197). */
let pstackInstalled = false;

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
  team.onTicketMerged((event) => mergedEvents.push(event));
  const merger: PullRequestMerger = {
    read: () =>
      Effect.sync(() => {
        const job = team.listJobs().find((candidate) => candidate.decision?.ticketId === fakeGitHub.ticketId);
        const head = job?.headCommit ?? "0".repeat(40);
        return {
          headSha: fakeGitHub.head === "match" ? head : "f".repeat(40),
          state: "open" as const,
          checks: "green" as const,
        };
      }),
    merge: (pr, input) =>
      Effect.sync(() => {
        fakeGitHub.merges.push({ number: pr.number, sha: input.sha, method: input.method });
      }),
  };
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
    merger,
    skills: { pstackReady: (playbook) => Effect.succeed(pstackInstalled && playbook === "tdd") },
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
  check(
    "the decision has a model for each role",
    (decision?.roles.length ?? 0) > 0 && decision?.roles.every((role) => role.model) === true,
  );
  check("the decision has a reason code and its sentence", Boolean(decision?.reasonCode && decision.reason));
  check("the decision keeps the repository", decision?.repo === "openbot/autopilot-e2e");
  check(
    "the job's ticket is the Backlog ticket, not a second one",
    first.board.list().filter((ticket) => ticket.teamJobId === featureJob?.id && ticket.teamRoleId === null).length ===
      1 && ticketOf(first, feature.id)?.teamJobId === featureJob?.id,
  );

  // 6. pstack is not installed: the failing-case Bug runs Autopilot lite and says why.
  const fallback = jobOf(first, bug.id)?.decision;
  record("bug decision without pstack", fallback ?? {});
  check("without pstack, the failing-case Bug runs Raven Stack", fallback?.stack === "raven-stack");
  check("without pstack, the decision has the pstack-missing reason", fallback?.reasonCode === "pstack-missing");
  check(
    "without pstack, the ticket has the note that names pstack-tdd",
    notes(first, bug.id).includes(sourceText("error.agent.autopilot.pstackMissing", { skill: "pstack-tdd" })),
  );

  // 1. Backlog → Needs review with the passed note.
  await waitFor("the feature job done", () => jobOf(first, feature.id)?.state === "done");
  await waitFor("the feature ticket in Needs review", () => ticketOf(first, feature.id)?.status === "needs_review");
  check("the feature ticket moved to Needs review", ticketOf(first, feature.id)?.status === "needs_review");
  check(
    "the feature ticket has the passed note",
    notes(first, feature.id).includes(sourceText("error.agent.autopilot.passed")),
  );
  record("feature ticket times", ticketOf(first, feature.id)?.statusTimes ?? {});

  // 2. The freed slot takes the chore.
  await waitFor("the chore job", () => jobOf(first, chore.id));
  await waitFor("every job done", () =>
    [feature, bug, chore].every((ticket) => jobOf(first, ticket.id)?.state === "done"),
  );
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
  record("stuck job", {
    state: jobOf(second, stuck.id)?.state,
    switches: jobOf(second, stuck.id)?.decision?.switches ?? [],
  });
  record("stuck ticket", { status: ticketOf(second, stuck.id)?.status, error: ticketOf(second, stuck.id)?.error });

  // 7. pstack · tdd: with the skill installed, a failing-case Bug runs one pstack playbook.
  settings = { ...settings, roundCap: 3 };
  pstackInstalled = true;
  const tdd = second.board.create({
    title: "Checkout fails when the cart has a coupon",
    body: "Steps to reproduce: add a coupon and open checkout. Expected: the total. Actual: TypeError.",
    type: "bug",
  });
  await waitFor("the pstack job", () => jobOf(second, tdd.id));
  const pstackJob = jobOf(second, tdd.id);
  const pstackDecision = pstackJob?.decision;
  record("pstack decision", pstackDecision ?? {});
  check("the failing-case Bug runs pstack", pstackDecision?.stack === "pstack");
  check("the pstack job runs the tdd playbook", pstackDecision?.playbook === "tdd");
  check("the pstack decision keeps the failing-case reason", pstackDecision?.reasonCode === "bug-failing-case");
  check(
    "the pstack job has a Builder and a Reviewer only",
    JSON.stringify(pstackJob?.roles.map((role) => role.roleId)) === JSON.stringify(["builder", "reviewer"]),
  );
  check(
    "the pstack decision lists the roles the job has",
    JSON.stringify(pstackDecision?.roles.map((role) => role.roleId)) === JSON.stringify(["builder", "reviewer"]),
  );
  const builderRole = await waitFor("the pstack Builder thread", () =>
    jobOf(second, tdd.id)?.roles.find((role) => role.roleId === "builder" && role.agentId && role.taskId),
  );
  const builderBrief =
    second.agents
      .readTask(builderRole.agentId ?? "", builderRole.taskId ?? "")
      .messages.find((message) => message.author === "user")?.text ?? "";
  check("the pstack Builder follows $pstack-tdd", builderBrief.includes("$pstack-tdd"));
  check("the pstack Builder gets no Raven Stack build skills", !builderBrief.includes("$raven-stack-build"));
  await waitFor("the pstack job done", () => jobOf(second, tdd.id)?.state === "done", 120_000);
  check("the pstack job passed the review", jobOf(second, tdd.id)?.state === "done");
  check(
    "the pstack ticket has no pstack-missing note",
    !notes(second, tdd.id).includes(sourceText("error.agent.autopilot.pstackMissing", { skill: "pstack-tdd" })),
  );

  // 8. Reviewer merge. Off by default: nothing merged so far, and the passed tickets wait in Needs review.
  check("with the merge setting off, nothing merged", fakeGitHub.merges.length === 0 && mergedEvents.length === 0);
  check("with the merge setting off, the passed job has no merge record", !jobOf(second, feature.id)?.decision?.merge);
  check("the Builder's pull request is on the decision", Boolean(jobOf(second, tdd.id)?.decision?.pullRequest));
  const mergeOn = (enabled: boolean): RavenAutopilotSettings => ({
    ...settings,
    reviewerMerge: { enabled, types: { feature: true, bug: false, chore: false }, method: "squash" },
  });
  const smallFeature = (title: string) =>
    second.board.create({ title, body: "Add it in src/ui/Tooltip.tsx.", type: "feature" });

  settings = mergeOn(true);
  fakeGitHub.head = "match";
  const merging = smallFeature("Add a tooltip to the save button");
  fakeGitHub.ticketId = merging.id;
  await waitFor("the merged job", () => jobOf(second, merging.id)?.decision?.merge?.state === "merged", 120_000);
  await waitFor("the merged ticket in Done", () => ticketOf(second, merging.id)?.status === "done");
  const mergedJob = jobOf(second, merging.id);
  record("merged decision", mergedJob?.decision?.merge ?? {});
  check("the passed head merged once", fakeGitHub.merges.length === 1);
  check("the merge names the head commit as its precondition", fakeGitHub.merges[0]?.sha === mergedJob?.headCommit);
  check("the merge uses the squash default", fakeGitHub.merges[0]?.method === "squash");
  check("the merged ticket moved to Done", ticketOf(second, merging.id)?.status === "done");
  check(
    "the merged ticket has the merged note",
    notes(second, merging.id).includes(sourceText("error.agent.autopilot.merged", { method: "squash", number: 7 })),
  );
  check("onTicketMerged fired once", mergedEvents.length === 1);
  check(
    "the ticket-merged event has the facts only",
    mergedEvents[0]?.ticketId === merging.id &&
      mergedEvents[0]?.prNumber === 7 &&
      mergedEvents[0]?.repo === "openbot/autopilot-e2e" &&
      mergedEvents[0]?.ci === "green" &&
      mergedEvents[0]?.commit === mergedJob?.headCommit,
  );

  fakeGitHub.head = "moved";
  const moved = smallFeature("Add a tooltip to the cancel button");
  fakeGitHub.ticketId = moved.id;
  await waitFor("the blocked merge", () => jobOf(second, moved.id)?.decision?.merge?.state === "blocked", 120_000);
  check("a new commit after PASS stops the merge", jobOf(second, moved.id)?.decision?.merge?.reason === "new-commit");
  check("the moved head did not merge", fakeGitHub.merges.length === 1);
  await waitFor("the blocked ticket in Needs review", () => ticketOf(second, moved.id)?.status === "needs_review");
  check(
    "the blocked ticket has the new-commit note",
    notes(second, moved.id).includes(sourceText("error.agent.autopilot.mergeBlocked.newCommit")),
  );

  settings = mergeOn(false);
  fakeGitHub.head = "match";
  const off = smallFeature("Add a tooltip to the close button");
  fakeGitHub.ticketId = off.id;
  await waitFor("the job after the setting went off", () => jobOf(second, off.id)?.state === "done", 120_000);
  await waitFor("its ticket in Needs review", () => ticketOf(second, off.id)?.status === "needs_review");
  check("after the setting went off, nothing more merged", fakeGitHub.merges.length === 1);
  check("after the setting went off, the job has no merge record", !jobOf(second, off.id)?.decision?.merge);

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
