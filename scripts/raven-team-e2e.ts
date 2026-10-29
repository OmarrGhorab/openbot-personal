// Checks a Raven Stack team: one agent per role, each on the model the message names, the handoffs
// between the roles, one writer, the FAIL round, the fallback question and the round cap.
//
// The real agent service, the team runtime and the team store run on a temporary profile. A scripted
// Codex app-server stands in for the provider. Each reply is written by a rule of this file: the
// Architect plans, the Builder reports a commit, the Reviewer fails the first head and passes the next,
// and the Quality role scores 10. No model runs, so this check shows what the team does with the
// reports; it does not show how a model writes a plan, code or a review.
//
// Checks: an unknown model stops the start and asks the user, and nothing is created; the start runs
// every role on its named model; a Reviewer FAIL goes to the Builder as findings; the new commit
// clears the old verdicts; the job ends done on one head with PASS and 10/10; a Builder that keeps
// failing asks for a stronger model, and the third FAIL round stops the job as not done.
//
// Workspace only access: the check makes the scripted provider stand for one that cannot run Workspace
// only on this computer (OpenCode on Linux). The confirm card then asks about each read-only role and
// the start is refused; Full access on the card starts the team. A provider that changes mid-job holds
// the role with the access question instead of Working with no turn; Full access, from the question or
// from the agent settings, sends the message that waited.
//
// Reasoning effort: the scripted provider lists efforts for one model. A role with a chosen effort
// gets its own role agent on that effort, and each of its turns carries the effort.
//
// Autopilot lite: the plan has only the Builder and the Reviewer. A job runs the Builder first, with
// no Architect turn, then the Reviewer; one FAIL round goes back to the Builder, and the job ends done.
//
// Several tickets: three tickets start three jobs. As many run at once as the role agents' work-thread
// limit allows; the rest show Queued, with no work thread, and start when a slot frees. Stop and resume
// of one job leave the others as they are, and each job keeps its own handoffs, verdicts and FAIL round.
//
// `bun scripts/raven-team-e2e.ts`. Writes .openbot-build/autonomy-6/raven-team-e2e.json.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/autonomy-6");
const root = await mkdtemp(join(tmpdir(), "openbot-raven-team-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
/** The models the scripted provider lists. The names are the test's, not a real provider's. */
const MODELS = ["gpt-6-luna", "gpt-6-sol", "gpt-6-nova"];
/** Head commits in the order the Builder makes them. The commit of a fix round is the next one. */
const HEADS = [
  "1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d",
  "2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e",
  "3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f",
];
const UNKNOWN_MODEL = "claude-opus-5-5";
/** The one model the scripted provider lists with effort levels: low, medium (its default) and high. */
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
const { RAVEN_STACK_LITE_TEMPLATE_ID, RAVEN_STACK_TEAM_TEMPLATE_ID, agentTaskLimit } = await import(
  "@openbot/contracts/ipc"
);

/**
 * A Codex app-server with the methods the service calls. It logs each turn with the model the
 * service sent and the role it belongs to, and it answers each role with the scripted reply above.
 */
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

interface TurnLogEntry {
  kind: string;
  threadId: string;
  turnId: string;
  model: string | null;
  effort?: string | null;
  role: string | null;
}

interface Check {
  name: string;
  passed: boolean;
}

interface ReportRun {
  name: string;
  detail: string;
}
interface SeenEvent {
  type: string;
  threadId: string;
  agentId: string;
}

const report: {
  model: string;
  passed: boolean;
  checks: Check[];
  runs: ReportRun[];
  turns: { role: string | null; model: string | null; effort: string | null }[];
  unverified: string[];
  error?: string;
} = {
  model: "none. A scripted Codex app-server stands in for the provider; no model runs.",
  passed: false,
  checks: [],
  runs: [],
  turns: [],
  unverified: [
    "A model that writes the plan, the code, the review or the score. The verdicts here are scripted.",
    "The stuck-role replacement (ticket 6.11). Not built.",
    "The stop and resume of a job. Covered by the code only, not by this run.",
    "The read-only access of the non-Builder roles. The brief asks for it; the runtime does not check the branch.",
    "A real provider that cannot run Workspace only. The check makes the scripted Codex stand for one.",
    "The Reviewer port rule (Builder port plus 5). The brief asks for it; no port is checked.",
    "The team view and the confirm card in the running app. Not run in this check.",
  ],
};

/** One run of the check: its name, and its result as JSON. */
const record = (name: string, detail: object): void => {
  report.runs.push({ name, detail: JSON.stringify(detail) });
};

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

/** Waits for a state of the team or the log. A timeout names the state it waited for. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function turnLog(): TurnLogEntry[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line): TurnLogEntry => JSON.parse(line));
}

function check(name: string, condition: boolean, detail?: string): void {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
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
let changes = 0;
/** True while the scripted provider stands for one that cannot run Workspace only here. */
let workspaceOnlyRefused = false;
const team = new RavenTeamService({
  store: new RavenTeamStore(database),
  agents,
  changed: () => {
    changes += 1;
  },
  platform: "linux",
  workspaceOnlySupported: () => !workspaceOnlyRefused,
});
const seenEvents: SeenEvent[] = [];
agents.on("turn", (event) => {
  if (event.type === "turn-started" || event.type === "turn-completed") {
    seenEvents.push({ type: event.type, threadId: event.threadId, agentId: event.agentId });
  }
  Effect.runFork(team.notice(event));
});
// An agent change can answer the access question, as in the app.
agents.on("event", (event) => {
  if (event.type === "agents-changed" || event.type === "error") Effect.runFork(team.notice(event));
});

const ASSIGNMENTS =
  "Autopilot ticket #42. Architect: gpt-6-luna. Builder: gpt-6-sol. Reviewer: gpt-6-nova. Quality: gpt-6-luna.";
const TICKET_TEXT = "Autopilot ticket #42: rename the helper. Keep the public API.";

try {
  await runCauseEffect(agents.initialize());

  // 1. The plan reads each name, and warns when a verifier shares the Builder's model.
  const sharing = team.plan({
    templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
    brief: "Autopilot ticket #42. Builder: gpt-6-sol. Quality: gpt-6-sol.",
  });
  check(
    "the plan warns when Quality uses the Builder model",
    sharing.warnings.some((warning) => warning.roleId === "quality" && warning.builderRoleId === "builder"),
    JSON.stringify(sharing.warnings),
  );
  const named = team.plan({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: ASSIGNMENTS });
  check(
    "the plan takes each named model for its role",
    ["architect", "builder", "reviewer", "quality"].every((roleId) => {
      const expected = /(\w+): (gpt-6-\w+)/g;
      const wanted = new Map([...ASSIGNMENTS.matchAll(expected)].map((match) => [match[1]?.toLowerCase(), match[2]]));
      return named.roles.find((role) => role.roleId === roleId)?.model === wanted.get(roleId);
    }),
    JSON.stringify(named.roles.map((role) => [role.roleId, role.model])),
  );
  check("the plan has no unknown model for known names", named.unknownModels.length === 0);

  // 2. An unknown model stops the start. Nothing is created, and the user is asked.
  const agentsBefore = agents.listAgents().length;
  const unknown = team.plan({
    templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
    brief: `Autopilot ticket #42. Architect: gpt-6-luna. Reviewer: ${UNKNOWN_MODEL}.`,
  });
  check(
    "the plan asks about the unknown model",
    unknown.unknownModels.some((entry) => entry.roleId === "reviewer" && entry.model === UNKNOWN_MODEL),
    JSON.stringify(unknown.unknownModels),
  );
  const refused = await runCauseEffect(
    team.start({
      templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
      brief: `Autopilot ticket #42. Architect: gpt-6-luna. Reviewer: ${UNKNOWN_MODEL}.`,
    }),
  ).then(
    () => null,
    (error: unknown) => String(error instanceof Error ? error.message : error),
  );
  check("the start stops at the unknown model", refused?.includes(UNKNOWN_MODEL) === true, refused ?? "started");
  check("no job is kept after the refused start", team.listJobs().length === 0);
  check("no role agent is made by the refused start", agents.listAgents().length === agentsBefore);
  record("unknown model", { refusal: refused, asked: unknown.unknownModels });

  // 3. A start runs every role on its model. One FAIL round, one new commit, PASS and 10/10 on one head.
  const started = await runCauseEffect(
    team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: `${ASSIGNMENTS} ${TICKET_TEXT}` }),
  );
  const done = await waitFor("the first job to end", () => {
    const job = team.listJobs().find((candidate) => candidate.id === started.id);
    return job && ["done", "not-done", "waiting-user"].includes(job.state) ? job : null;
  });
  check("the first job is done", done.state === "done", `state ${done.state}, rounds ${done.fixRounds}`);
  check("the job ends on the second head", done.headCommit === HEADS[1], String(done.headCommit));
  check("the job ran one FAIL round", done.fixRounds === 1, String(done.fixRounds));
  const reviewer = done.roles.find((role) => role.roleId === "reviewer");
  const quality = done.roles.find((role) => role.roleId === "quality");
  check(
    "the reviewer passed the final head",
    reviewer?.verdict === "PASS" && reviewer.commit === HEADS[1],
    JSON.stringify(reviewer),
  );
  check(
    "the quality role scored 10 on the final head",
    quality?.verdict === "PASS" && quality.score === 10 && quality.commit === HEADS[1],
    JSON.stringify(quality),
  );
  check("the reviewer FAIL count is one", reviewer?.fails === 1, String(reviewer?.fails));
  const roleModels = Object.fromEntries(done.roles.map((role) => [role.roleId, role.model]));
  for (const role of done.roles) {
    const agent = agents.listAgents().find((candidate) => candidate.id === role.agentId);
    check(
      `the ${role.roleId} agent runs on ${role.model}`,
      agent?.model === role.model && role.model === roleModels[role.roleId],
      `agent ${agent?.model ?? "none"}, role ${role.model}`,
    );
  }
  const turns = turnLog();
  const roleTurns = turns.filter((turn) => turn.role !== null);
  check(
    "every role turn carries its role model",
    roleTurns.length > 0 &&
      roleTurns.every((turn) => turn.model !== null && turn.model === roleModels[turn.role?.toLowerCase() ?? ""]),
    JSON.stringify(roleTurns.slice(0, 4)),
  );
  record("named models, one FAIL round", {
    jobId: done.id,
    state: done.state,
    headCommit: done.headCommit,
    fixRounds: done.fixRounds,
    roles: done.roles.map(({ roleId, model, provider, access, state, verdict, score, commit, fails }) => ({
      roleId,
      model,
      provider,
      access,
      state,
      verdict,
      score,
      commit,
      fails,
    })),
  });

  // 4. A reviewer that always fails: the second FAIL round asks for a stronger model; the third stops.
  const turnsBeforeHard = turnLog().length;
  const hard = await runCauseEffect(
    team.start({
      templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
      brief: `${ASSIGNMENTS} SCRIPT-ALWAYS-FAIL ${TICKET_TEXT}`,
    }),
  );
  check(
    "a second job reuses the role agent with the same role and model",
    agents.listAgents().filter((agent) => agent.name === "Raven Reviewer (gpt-6-nova)").length === 1,
    String(agents.listAgents().filter((agent) => agent.name === "Raven Reviewer (gpt-6-nova)").length),
  );
  const asked = await waitFor("the fallback question", () => {
    const job = team.listJobs().find((candidate) => candidate.id === hard.id);
    return job?.question?.kind === "fallback-model" ? job : null;
  });
  check("the second FAIL round asks for a fallback model", asked.state === "waiting-user", asked.state);
  check("the question names the Builder", asked.question?.roleId === "builder", JSON.stringify(asked.question));
  check("two FAIL rounds ran before the question", asked.fixRounds === 2, String(asked.fixRounds));
  await runCauseEffect(team.setRoleModel({ jobId: asked.id, roleId: "builder", model: "gpt-6-luna" }));
  const capped = await waitFor("the job to stop at the cap", () => {
    const job = team.listJobs().find((candidate) => candidate.id === hard.id);
    return job && (job.state === "not-done" || job.state === "done") ? job : null;
  });
  check("the third FAIL round stops the job as not done", capped.state === "not-done", capped.state);
  check("the job stopped at the round cap", capped.fixRounds === 3, String(capped.fixRounds));
  const builderAfter = capped.roles.find((role) => role.roleId === "builder");
  check(
    "the Builder runs on the model the user named",
    builderAfter?.model === "gpt-6-luna",
    String(builderAfter?.model),
  );
  // The Builder turns of this job, in order: the plan, the first findings (Builder on the start model),
  // then the findings after the question (the named model).
  const builderTurns = turnLog()
    .slice(turnsBeforeHard)
    .filter((turn) => turn.role === "Builder");
  check(
    "the Builder turns run on the start model, then on the named model",
    JSON.stringify(builderTurns.map((turn) => turn.model)) === JSON.stringify(["gpt-6-sol", "gpt-6-sol", "gpt-6-luna"]),
    JSON.stringify(builderTurns.map((turn) => turn.model)),
  );
  record("always-fail reviewer: fallback question and round cap", {
    jobId: capped.id,
    state: capped.state,
    fixRounds: capped.fixRounds,
    roundCap: capped.roundCap,
    question: asked.question,
    builderModelAfterQuestion: builderAfter?.model ?? null,
  });

  // 5. A named fallback model: after the second FAIL the Builder moves to it, with no question.
  const fallback = await runCauseEffect(
    team.start({
      templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
      brief: `${ASSIGNMENTS} Fallback: gpt-6-luna. SCRIPT-ALWAYS-FAIL ${TICKET_TEXT}`,
    }),
  );
  check(
    "the plan keeps the named fallback model",
    fallback.fallbackModel === "gpt-6-luna",
    String(fallback.fallbackModel),
  );
  const turnsBeforeFallback = turnLog().length;
  const fallbackEnd = await waitFor("the fallback job to stop at the cap", () => {
    const job = team.listJobs().find((candidate) => candidate.id === fallback.id);
    return job && (job.state === "not-done" || job.state === "done" || job.state === "waiting-user") ? job : null;
  });
  check(
    "the named fallback does not ask the user",
    fallbackEnd.question === null && fallbackEnd.state === "not-done",
    `state ${fallbackEnd.state}, question ${JSON.stringify(fallbackEnd.question)}`,
  );
  const fallbackBuilder = turnLog()
    .slice(turnsBeforeFallback)
    .filter((turn) => turn.role === "Builder")
    .map((turn) => turn.model);
  check(
    "the Builder moves to the named fallback after two FAIL rounds",
    JSON.stringify(fallbackBuilder) === JSON.stringify(["gpt-6-sol", "gpt-6-sol", "gpt-6-luna"]),
    JSON.stringify(fallbackBuilder),
  );
  record("named fallback model", {
    jobId: fallbackEnd.id,
    state: fallbackEnd.state,
    fixRounds: fallbackEnd.fixRounds,
    builderTurnModels: fallbackBuilder,
  });

  // 6. Stop and resume the whole team. A stopped job starts no turn; a resumed job runs to its end.
  const paused = await runCauseEffect(
    team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: `${ASSIGNMENTS} ${TICKET_TEXT}` }),
  );
  const stopped = await runCauseEffect(team.stop(paused.id));
  check("stop holds the job", stopped.state === "stopped", stopped.state);
  check(
    "no role of a stopped job is working",
    stopped.roles.every((role) => role.state !== "working"),
    JSON.stringify(stopped.roles.map((role) => [role.roleId, role.state])),
  );
  const resumed = await runCauseEffect(team.resume(paused.id));
  check("resume starts the job again", resumed.state === "running", resumed.state);
  const resumedEnd = await waitFor("the resumed job to end", () => {
    const job = team.listJobs().find((candidate) => candidate.id === paused.id);
    return job && (job.state === "done" || job.state === "not-done" || job.state === "waiting-user") ? job : null;
  });
  check(
    "the resumed job ends done on one head",
    resumedEnd.state === "done" && resumedEnd.headCommit !== null,
    resumedEnd.state,
  );
  record("stop and resume", {
    jobId: paused.id,
    afterStop: stopped.state,
    afterResume: resumed.state,
    end: resumedEnd.state,
  });

  // 7. Workspace only that this computer cannot run: the confirm card asks, and Full access starts it.
  workspaceOnlyRefused = true;
  const jobsBeforeAccess = team.listJobs().length;
  const blockedPlan = team.plan({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: ASSIGNMENTS });
  check(
    "the plan asks about every read-only role",
    JSON.stringify(blockedPlan.accessProblems.map((problem) => problem.roleId)) ===
      JSON.stringify(["architect", "reviewer", "quality"]),
    JSON.stringify(blockedPlan.accessProblems),
  );
  const accessRefusal = await runCauseEffect(
    team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: `${ASSIGNMENTS} ${TICKET_TEXT}` }),
  ).then(
    () => null,
    (error: unknown) => String(error instanceof Error ? error.message : error),
  );
  check(
    "the start stops at the access question",
    /^Architect can't run read-only with .+ on Linux, so the team did not start\./.test(accessRefusal ?? ""),
    accessRefusal ?? "started",
  );
  check("no job is kept after the access refusal", team.listJobs().length === jobsBeforeAccess);
  const fullAccess = ["architect", "reviewer", "quality"];
  const clearedPlan = team.plan({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: ASSIGNMENTS, fullAccess });
  check(
    "Full access on the card clears the question",
    clearedPlan.accessProblems.length === 0 && clearedPlan.roles.every((role) => role.fullAccess),
    JSON.stringify(clearedPlan.accessProblems),
  );
  const fullJob = await runCauseEffect(
    team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: `${ASSIGNMENTS} ${TICKET_TEXT}`, fullAccess }),
  );
  const fullEnd = await waitFor("the Full access job to end", () => {
    const job = team.listJobs().find((candidate) => candidate.id === fullJob.id);
    return job && ["done", "not-done", "waiting-user"].includes(job.state) ? job : null;
  });
  check("the Full access job ends done", fullEnd.state === "done", fullEnd.state);
  check(
    "each role agent of that job has Full access",
    fullEnd.roles.every((role) => agents.listAgents().find((agent) => agent.id === role.agentId)?.access === "full"),
    JSON.stringify(fullEnd.roles.map((role) => agents.listAgents().find((agent) => agent.id === role.agentId)?.access)),
  );
  record("access question on the confirm card", {
    asked: blockedPlan.accessProblems,
    refusal: accessRefusal,
    afterFullAccess: { jobId: fullEnd.id, state: fullEnd.state },
  });

  // 8. The provider changes mid-job: the verifiers wait with the question, not Working with no turn.
  workspaceOnlyRefused = false;
  const midJob = await runCauseEffect(
    team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: `${ASSIGNMENTS} ${TICKET_TEXT}` }),
  );
  workspaceOnlyRefused = true;
  const turnsBeforeQuestion = turnLog().length;
  const accessAsked = await waitFor("the access question mid-job", () => {
    const job = team.listJobs().find((candidate) => candidate.id === midJob.id);
    const held = job?.roles.filter((role) => role.state === "blocked").length ?? 0;
    return job?.question?.kind === "workspace-access" && held === 2 ? job : null;
  });
  check("the job waits for the user", accessAsked.state === "waiting-user", accessAsked.state);
  check(
    "the question names the Reviewer and the system",
    accessAsked.question?.roleId === "reviewer" && accessAsked.question.platform === "linux",
    JSON.stringify(accessAsked.question),
  );
  check(
    "no verifier shows Working with no turn",
    accessAsked.roles
      .filter((role) => role.roleId === "reviewer" || role.roleId === "quality")
      .every((role) => role.state === "blocked" && role.taskId === null),
    JSON.stringify(accessAsked.roles.map((role) => [role.roleId, role.state, role.taskId])),
  );
  await new Promise((done) => setTimeout(done, 300));
  check(
    "no verifier turn ran while the question waits",
    !turnLog()
      .slice(turnsBeforeQuestion)
      .some((turn) => turn.role === "Reviewer" || turn.role === "Quality"),
  );
  // The one-click answer: the Reviewer gets Full access and its waiting message is sent.
  await runCauseEffect(team.giveRoleFullAccess({ jobId: midJob.id, roleId: "reviewer" }));
  const qualityAsked = await waitFor("the question to move to Quality", () => {
    const job = team.listJobs().find((candidate) => candidate.id === midJob.id);
    return job?.question?.kind === "workspace-access" && job.question.roleId === "quality" ? job : null;
  });
  check("the question moves to the next role", qualityAsked.state === "waiting-user", qualityAsked.state);
  // The agent settings answer it too: Full access on the Quality agent sends its waiting message.
  const qualityRole = qualityAsked.roles.find((role) => role.roleId === "quality");
  await runCauseEffect(agents.updateAgent({ agentId: qualityRole?.agentId ?? "", access: "full" }));
  const accessEnd = await waitFor("the job to end after Full access", () => {
    const job = team.listJobs().find((candidate) => candidate.id === midJob.id);
    return job && (job.state === "done" || job.state === "not-done") ? job : null;
  });
  check("the job ends done after the access answers", accessEnd.state === "done", accessEnd.state);
  const roleTurnsAfter = turnLog()
    .slice(turnsBeforeQuestion)
    .map((turn) => turn.role);
  check(
    "the waiting Reviewer and Quality messages ran after Full access",
    roleTurnsAfter.includes("Reviewer") && roleTurnsAfter.includes("Quality"),
    JSON.stringify(roleTurnsAfter),
  );
  workspaceOnlyRefused = false;
  record("access question mid-job", {
    jobId: accessEnd.id,
    question: accessAsked.question,
    rolesWhileAsked: accessAsked.roles.map((role) => [role.roleId, role.state]),
    end: accessEnd.state,
    roleTurnsAfterQuestion: roleTurnsAfter,
  });

  // 9. Reasoning effort: the Builder on gpt-6-sol with the effort high. The plan, the role agent and
  // every Builder turn carry it; a role on a model with no chosen effort keeps its default.
  const effortPlan = team.plan({
    templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
    brief: ASSIGNMENTS,
    efforts: { builder: "high" },
  });
  check(
    "the plan carries the chosen effort",
    effortPlan.roles.find((role) => role.roleId === "builder")?.reasoningEffort === "high",
    JSON.stringify(effortPlan.roles.map((role) => [role.roleId, role.reasoningEffort])),
  );
  const turnsBeforeEffort = turnLog().length;
  const effortJob = await runCauseEffect(
    team.start({
      templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
      brief: `${ASSIGNMENTS} ${TICKET_TEXT}`,
      efforts: { builder: "high" },
    }),
  );
  const effortEnd = await waitFor("the effort job to end", () => {
    const job = team.listJobs().find((candidate) => candidate.id === effortJob.id);
    return job && ["done", "not-done", "waiting-user"].includes(job.state) ? job : null;
  });
  check("the effort job ends done", effortEnd.state === "done", effortEnd.state);
  const effortBuilder = agents
    .listAgents()
    .find((agent) => agent.id === effortEnd.roles.find((role) => role.roleId === "builder")?.agentId);
  check(
    "the Builder runs in its own agent on the chosen effort",
    effortBuilder?.name === "Raven Builder (gpt-6-sol, high)" && effortBuilder.reasoningEffort === "high",
    `${effortBuilder?.name} ${effortBuilder?.reasoningEffort}`,
  );
  const effortTurns = turnLog()
    .slice(turnsBeforeEffort)
    .filter((turn) => turn.role === "Builder");
  check(
    "every Builder turn carries the effort high",
    effortTurns.length > 0 && effortTurns.every((turn) => turn.effort === "high"),
    JSON.stringify(effortTurns.map((turn) => turn.effort)),
  );
  record("reasoning effort", {
    jobId: effortEnd.id,
    state: effortEnd.state,
    builderAgent: effortBuilder?.name ?? null,
    builderTurnEfforts: effortTurns.map((turn) => turn.effort ?? null),
  });

  // 10. Autopilot lite: Builder then Reviewer, no Architect and no Quality turn.
  const LITE_ASSIGNMENTS = "Autopilot lite ticket #43. Builder: gpt-6-sol. Reviewer: gpt-6-nova.";
  const litePlan = team.plan({ templateId: RAVEN_STACK_LITE_TEMPLATE_ID, brief: LITE_ASSIGNMENTS });
  check(
    "the lite plan has only the Builder and the Reviewer",
    JSON.stringify(litePlan.roles.map((role) => role.roleId)) === JSON.stringify(["builder", "reviewer"]),
    JSON.stringify(litePlan.roles.map((role) => role.roleId)),
  );
  const turnsBeforeLite = turnLog().length;
  const liteJob = await runCauseEffect(
    team.start({ templateId: RAVEN_STACK_LITE_TEMPLATE_ID, brief: `${LITE_ASSIGNMENTS} ${TICKET_TEXT}` }),
  );
  const liteEnd = await waitFor("the lite job to end", () => {
    const job = team.listJobs().find((candidate) => candidate.id === liteJob.id);
    return job && ["done", "not-done", "waiting-user"].includes(job.state) ? job : null;
  });
  check("the lite job ends done", liteEnd.state === "done", liteEnd.state);
  check("the lite job ran one FAIL round", liteEnd.fixRounds === 1, String(liteEnd.fixRounds));
  check(
    "the lite job has no Architect or Quality role",
    liteEnd.roles.every((role) => role.roleId === "builder" || role.roleId === "reviewer"),
    JSON.stringify(liteEnd.roles.map((role) => role.roleId)),
  );
  const liteTurns = turnLog()
    .slice(turnsBeforeLite)
    .map((turn) => turn.role);
  check(
    "the lite job runs Builder, Reviewer, Builder, Reviewer and no Architect turn",
    JSON.stringify(liteTurns) === JSON.stringify(["Builder", "Reviewer", "Builder", "Reviewer"]),
    JSON.stringify(liteTurns),
  );
  record("autopilot lite", {
    jobId: liteEnd.id,
    state: liteEnd.state,
    fixRounds: liteEnd.fixRounds,
    roleTurns: liteTurns,
  });

  // 11. Several tickets: one job per ticket, in parallel up to the work-thread limit, the rest Queued.
  const MULTI_ASSIGNMENTS = "Builder: gpt-6-nova. Reviewer: gpt-6-luna.";
  const multiTickets = [51, 52, 53].map(
    (number) => `Autopilot lite ticket #${number}. ${MULTI_ASSIGNMENTS} SCRIPT-SLOW Rename helper ${number}.`,
  );
  const multiJobs = [];
  for (const ticket of multiTickets) {
    multiJobs.push(await runCauseEffect(team.start({ templateId: RAVEN_STACK_LITE_TEMPLATE_ID, brief: ticket })));
  }
  const multiIds = multiJobs.map((job) => job.id);
  check("three tickets start three jobs", new Set(multiIds).size === 3, JSON.stringify(multiIds));
  const multiBuilder = agents
    .listAgents()
    .find((agent) => agent.id === multiJobs[0]?.roles.find((role) => role.roleId === "builder")?.agentId);
  const limit = multiBuilder ? agentTaskLimit(multiBuilder) : 0;
  check("the jobs share a Builder agent with a limit of two", limit === 2, `${multiBuilder?.name} ${limit}`);
  const firstView = multiIds.map((id) => team.listJobs().find((job) => job.id === id));
  const runningAtOnce = firstView.filter((job) => job && !job.queued && job.state === "running");
  const queuedAtStart = firstView.filter((job) => job?.queued === true);
  check(
    "two jobs run at the same time",
    runningAtOnce.length === 2,
    JSON.stringify(firstView.map((job) => [job?.state, job?.queued])),
  );
  const queuedJob = queuedAtStart[0];
  check(
    "the third job is Queued, with no work thread",
    queuedAtStart.length === 1 &&
      queuedJob !== undefined &&
      queuedJob.id === multiIds[2] &&
      queuedJob.state === "running" &&
      queuedJob.roles.every((role) => role.taskId === null),
    JSON.stringify(queuedAtStart.map((job) => [job?.id, job?.roles.map((role) => role.taskId)])),
  );
  const builderThreads = runningAtOnce.map((job) => job?.roles.find((role) => role.roleId === "builder")?.threadId);
  check(
    "each running job has its own Builder work thread",
    builderThreads.every((thread) => typeof thread === "string") &&
      new Set(builderThreads).size === builderThreads.length,
    JSON.stringify(builderThreads),
  );
  // Stop the first job. The second keeps running, and the queued job takes the free slot.
  const [first = "", second = "", third = ""] = multiIds;
  const secondBefore = team.listJobs().find((job) => job.id === second);
  const stoppedOne = await runCauseEffect(team.stop(first));
  check("stop holds only that job", stoppedOne.state === "stopped", stoppedOne.state);
  const secondAfterStop = team.listJobs().find((job) => job.id === second);
  check(
    "stop of one job leaves the other running job as it was",
    secondAfterStop?.state === "running" &&
      JSON.stringify(secondAfterStop.roles.map((role) => role.taskId)) ===
        JSON.stringify(secondBefore?.roles.map((role) => role.taskId)),
    JSON.stringify(secondAfterStop?.roles.map((role) => [role.roleId, role.state])),
  );
  const freed = await waitFor("the queued job to start after a stop", () => {
    const job = team.listJobs().find((candidate) => candidate.id === third);
    return job && !job.queued && job.roles.some((role) => role.taskId !== null) ? job : null;
  });
  check("the queued job starts when a slot frees", freed.state === "running" && !freed.queued, freed.state);
  const ended = (id: string) => {
    const job = team.listJobs().find((candidate) => candidate.id === id);
    return job && ["done", "not-done", "waiting-user"].includes(job.state) ? job : null;
  };
  const secondEnd = await waitFor("the second job to end", () => ended(second));
  const thirdEnd = await waitFor("the third job to end", () => ended(third));
  check(
    "the stopped job stays stopped while the others end",
    team.listJobs().find((job) => job.id === first)?.state === "stopped",
  );
  // Resume the stopped job. It runs to its own end, and the jobs that ended stay as they were.
  const resumedOne = await runCauseEffect(team.resume(first));
  check("resume starts only that job", resumedOne.state === "running", resumedOne.state);
  const firstEnd = await waitFor("the resumed job to end", () => ended(first), 90_000);
  check(
    "resume of one job leaves the ended jobs as they were",
    team.listJobs().find((job) => job.id === second)?.state === secondEnd.state &&
      team.listJobs().find((job) => job.id === third)?.state === thirdEnd.state,
  );
  const multiEnds = [firstEnd, secondEnd, thirdEnd];
  check(
    "each job ends done with its own FAIL round",
    multiEnds.every((job) => job.state === "done" && job.fixRounds === 1),
    JSON.stringify(multiEnds.map((job) => [job.state, job.fixRounds])),
  );
  check(
    "each job keeps its own Reviewer verdict on its own head",
    multiEnds.every((job) => {
      const review = job.roles.find((role) => role.roleId === "reviewer");
      return review?.verdict === "PASS" && review.fails === 1 && review.commit === job.headCommit;
    }),
    JSON.stringify(multiEnds.map((job) => job.roles.map((role) => [role.roleId, role.verdict, role.fails]))),
  );
  const multiThreads = multiEnds.flatMap((job) => job.roles.map((role) => role.threadId));
  check(
    "no two jobs share a role work thread",
    multiThreads.every((thread) => thread !== null) && new Set(multiThreads).size === multiThreads.length,
    JSON.stringify(multiThreads),
  );
  record("several tickets", {
    limit,
    runningAtOnce: runningAtOnce.length,
    queuedAtStart: queuedAtStart.map((job) => job?.id ?? null),
    ends: multiEnds.map((job) => ({ jobId: job.id, state: job.state, fixRounds: job.fixRounds })),
  });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  record("state at the failure", {
    events: seenEvents,
    tasks: agents.listAgents().map((agent) => ({
      agent: agent.name,
      tasks: agents.listTasks(agent.id).tasks.map((task) => ({
        id: task.id,
        state: task.state,
        hold: task.hold,
        queued: task.queuedMessages.length,
        progress: task.progress,
      })),
      queue: agents.listQueue(agent.id).deliveries.map((delivery) => delivery.status),
    })),
    jobs: team.listJobs().map((job) => ({
      state: job.state,
      question: job.question,
      headCommit: job.headCommit,
      roles: job.roles.map((role) => ({
        roleId: role.roleId,
        state: role.state,
        verdict: role.verdict,
        threadId: role.threadId,
        taskId: role.taskId,
      })),
    })),
  });
  process.exitCode = 1;
} finally {
  record("changes", { changesEmitted: changes });
  report.turns = turnLog()
    .filter((turn) => turn.role !== null)
    .map((turn) => ({ role: turn.role, model: turn.model, effort: turn.effort ?? null }));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "raven-team-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

process.stdout.write(`raven team e2e: ${report.passed ? "passed" : "failed"} (${report.checks.length} checks)\n`);
if (!report.passed) process.stderr.write(`${report.error}\n`);
process.exit(process.exitCode ?? 0);
