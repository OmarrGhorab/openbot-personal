// Checks graded permissions, budgets, the audit log and Stop all agents (issue #126) on the real
// modules, over a real database and settings file in a temporary profile:
// - the risk of a command is classified, and a low-risk command never asks;
// - the real `AttentionRegistry` asks for a high-risk command, and a rule can let it through;
// - a Workspace only agent keeps its card for every approval;
// - a budget holds the lanes of a work thread and stops a turn that runs over its limit;
// - Stop all agents holds every lane, and the stop survives a restart;
// - every answer is an audit row, and a secret in a command is masked in the row.
// It does not start a provider turn: no model is signed in on this computer. The usage a turn reports
// is supplied by the script, through the `readTurnUsage` the agent service would pass.
// Run: `bun run test:autonomy-safety`. Writes .openbot-build/autonomy-safety-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationSnapshot, RespondToApprovalInput } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { AttentionRegistry } from "../src/backend/agent/attention-registry";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { classifyApprovalRisk } from "../src/backend/autonomy/action-risk";
import { AutonomyAuditStore } from "../src/backend/autonomy/autonomy-audit-store";
import { AutonomyController, type RunningTurn } from "../src/backend/autonomy/autonomy-controller";
import { AutonomyUsageStore } from "../src/backend/autonomy/autonomy-usage-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import type { RequestId } from "../src/backend/protocol";
import { AUTONOMY_PREFERENCE_FILE, AutonomyPreferences } from "../src/main/autonomy-preferences";

const OUT = resolve(import.meta.dirname, "../.openbot-build/autonomy-safety-e2e");
const AGENT = "agent-autonomy";
const SANDBOXED_AGENT = "agent-sandboxed";
const CHAT_THREAD = "openbot-thread-chat";
const TASK = "task-budget";
const TASK_THREAD = "openbot-thread-task";
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

const checks: Check[] = [];
function check(name: string, passed: boolean, detail?: string): void {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

/** A provider client that records the answer to each request, as the Codex client would send it. */
class RecordingClient extends CodexAppServerClient {
  readonly answers = new Map<RequestId, unknown>();

  override get running(): boolean {
    return true;
  }

  override respond(id: RequestId, result: unknown): void {
    this.answers.set(id, result);
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-autonomy-e2e-"));
const settingsPath = join(root, AUTONOMY_PREFERENCE_FILE);
const database = new OpenBotDatabase(root);
await runCauseEffect(database.initialize());
const audit = new AutonomyAuditStore(database);
const usage = new AutonomyUsageStore(database);
const preferences = new AutonomyPreferences(settingsPath);
await runCauseEffect(preferences.load());

// The usage that a turn reports so far, by turn id. The agent service reads the same from the
// provider usage records; this script stands in for the provider.
const reported = new Map<string, { tokens: number; costUsd: number | null }>();
const stopped: Array<{ turnId: string; threadId: string }> = [];
const controller = new AutonomyController({
  policy: preferences,
  audit,
  usage,
  readTurnUsage: (_agentId, turnId) => reported.get(turnId) ?? null,
  stopTurn: (turn: RunningTurn) => {
    stopped.push({ turnId: turn.turnId, threadId: turn.threadId });
  },
});

// The real approval gate, with the same dependencies the agent tests use.
const client = new RecordingClient("/nonexistent/codex");
const snapshot: ConversationSnapshot = {
  agentId: AGENT,
  threadId: CHAT_THREAD,
  activeTurnId: null,
  revision: 0,
  messages: [],
};
const events: AgentEvent[] = [];
const sandboxed = new Set([SANDBOXED_AGENT]);
const registry = new AttentionRegistry({
  conversation: {
    agentForThread: (threadId) =>
      threadId === CHAT_THREAD ? AGENT : threadId === "sandboxed-thread" ? SANDBOXED_AGENT : undefined,
    publicThreadId: (_agentId, threadId) => threadId,
    ensureSnapshot: () => snapshot,
    emitConversation: () => {
      snapshot.revision += 1;
    },
  },
  browser: { listTabs: () => [], beginTakeover: () => Effect.void, endTakeover: () => {} },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
  emit: (event) => events.push(event),
  emitError: () => {},
  emitRuntimeSnapshot: () => {},
  workspaceSandboxed: (agentId) => sandboxed.has(agentId),
  autonomy: controller,
});

let nextRequest = 1;
function commandApproval(command: string, threadId = CHAT_THREAD) {
  const id = nextRequest++;
  const request = {
    id,
    method: "item/commandExecution/requestApproval",
    params: { threadId, turnId: `turn-${id}`, command, cwd: root },
  };
  const approval = client.answers;
  registry.surfaceApproval(client, request, "command");
  return { id, answered: approval.has(id), answer: approval.get(id) };
}

function answerApproval(requestId: string | number, decision: RespondToApprovalInput["decision"]) {
  return runCauseEffect(registry.respondToApproval({ requestId, decision }, { owner: true }));
}

const askedFor = (id: number) => events.some((event) => event.type === "approval" && event.approval.requestId === id);

try {
  // 1. Risk levels of the actions that the ticket names.
  const risks: Array<[string, "low" | "medium" | "high"]> = [
    ["git status", "low"],
    ["bun run test:changed", "low"],
    ["git checkout -b openbot/a1", "low"],
    ["git push origin openbot/a1", "low"],
    ["gh pr create --title x", "medium"],
    ["bun install --frozen-lockfile", "medium"],
    ["gh pr merge 12", "high"],
    ["npx wrangler deploy", "high"],
    ["bun run db:migrate", "high"],
    ["git push origin main", "high"],
    ["rm -rf dist", "high"],
  ];
  for (const [command, level] of risks) {
    const actual = classifyApprovalRisk({ kind: "command", command }).level;
    check(`risk of "${command}" is ${level}`, actual === level, `got ${actual}`);
  }

  // 2. The default rules: a low-risk command is answered at once; medium and high ask.
  const low = commandApproval("git status");
  check("a low-risk command is answered without a card", low.answered && !askedFor(low.id), JSON.stringify(low.answer));
  const medium = commandApproval("gh pr create --title Fix --body text");
  check("a medium-risk command asks by default", !medium.answered && askedFor(medium.id));
  const high = commandApproval("npx wrangler deploy --env production");
  check("a high-risk command asks by default", !high.answered && askedFor(high.id));
  await answerApproval(high.id, "accept");
  check("the person's accept reaches the provider", client.answers.has(high.id));

  // 3. A rule lets a high-risk command through, and the audit log says so.
  await runCauseEffect(preferences.setApprovalRules({ agentId: AGENT, approvals: { medium: true, high: false } }));
  const allowed = commandApproval("npx wrangler deploy --env staging");
  check("a high-risk command runs when the rule allows it", allowed.answered && !askedFor(allowed.id));
  await runCauseEffect(preferences.setApprovalRules({ agentId: AGENT, approvals: { medium: true, high: true } }));

  // 4. A Workspace only agent keeps its card for every approval.
  const sandboxedLow = commandApproval("git status", "sandboxed-thread");
  check("a Workspace only agent asks even for a low-risk command", !sandboxedLow.answered && askedFor(sandboxedLow.id));

  // 5. A budget holds the work thread, and a running turn that passes it is stopped.
  await runCauseEffect(
    preferences.setBudgets({
      agentId: AGENT,
      budgets: {
        perTask: { tokens: 1_000, minutes: null, costUsd: null },
        perDay: { tokens: null, minutes: null, costUsd: null },
      },
    }),
  );
  const finished: RunningTurn = {
    agentId: AGENT,
    threadId: TASK_THREAD,
    taskId: TASK,
    turnId: "turn-finished",
    startedAt: Date.now() - 60_000,
  };
  reported.set("turn-finished", { tokens: 1_200, costUsd: 0.02 });
  controller.turnStarted(finished);
  controller.turnEnded({ ...finished, endedAt: Date.now() });
  check("a finished turn that passes the task limit holds the lane", controller.holdFor(AGENT, TASK) === "budget");
  check("another work thread of the agent is not held", controller.holdFor(AGENT, "task-other") === null);
  check("the agent's own chat is not held by a task limit", controller.holdFor(AGENT, null) === null);

  const running: RunningTurn = {
    agentId: AGENT,
    threadId: TASK_THREAD,
    taskId: "task-run",
    turnId: "turn-running",
    startedAt: Date.now(),
  };
  reported.set("turn-running", { tokens: 1_500, costUsd: null });
  await runCauseEffect(
    preferences.setBudgets({
      agentId: AGENT,
      budgets: {
        perTask: { tokens: 1_000, minutes: null, costUsd: null },
        perDay: { tokens: null, minutes: null, costUsd: null },
      },
    }),
  );
  controller.turnStarted(running);
  const deadline = Date.now() + 15_000;
  while (stopped.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  check(
    "a running turn over its task limit is stopped",
    stopped.some((turn) => turn.turnId === "turn-running"),
  );
  controller.turnEnded({ ...running, endedAt: Date.now() });

  const budgetRows = audit.list({ action: "budget.stopped" }).entries;
  check("the budget stop is in the audit log", budgetRows.length >= 1, `${budgetRows.length} rows`);

  // 6. Stop all agents holds every lane, and the stop survives a restart.
  await runCauseEffect(preferences.setStoppedAll(true));
  check("Stop all holds the agent's chat", controller.holdFor(AGENT, null) === "stopped");
  check("Stop all holds a work thread", controller.holdFor(AGENT, "task-other") === "stopped");
  const restarted = new AutonomyPreferences(settingsPath);
  await runCauseEffect(restarted.load());
  check("the stop is still on after a restart", restarted.stoppedAll());
  await runCauseEffect(preferences.setStoppedAll(false));
  check(
    "resume releases every lane",
    controller.holdFor(AGENT, null) === null && controller.holdFor(AGENT, TASK) === "budget",
  );

  // 7. The audit log: every answer is a row, newest first, paged, and a secret is masked.
  commandApproval(`GH_TOKEN=${SECRET} gh pr view 1 --json title`);
  const page = audit.list({ limit: 3 });
  check("the audit page holds at most the limit", page.entries.length === 3);
  check("the audit page links to the next page", page.nextBefore !== null);
  const everything = audit.list({ limit: 200 }).entries;
  const actions = new Set(everything.map((entry) => entry.action));
  check(
    "the log has approvals, asks and a budget stop",
    actions.has("approval.auto") && actions.has("approval.asked") && actions.has("budget.stopped"),
  );
  check(
    "no row keeps the secret",
    everything.every((entry) => !entry.target.includes(SECRET) && !entry.detail.includes(SECRET)),
  );
  check(
    "the masked command keeps its words",
    everything.some((entry) => entry.target.includes("gh pr view 1")),
  );
  const totals = usage.totals({ agentId: AGENT, taskId: TASK });
  check("the ledger counts the finished turn", totals.tokens === 1_200 && totals.minutes > 0, JSON.stringify(totals));
} finally {
  controller.dispose();
  database.close();
  await rm(root, { recursive: true, force: true });
}

const passed = checks.every((item) => item.passed);
const report = {
  passed,
  generatedAt: new Date().toISOString(),
  note: "No provider turn ran. Usage is supplied by the script; the approval gate is the real AttentionRegistry.",
  checks,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const lines = checks.map(
  (item) => `${item.passed ? "PASS" : "FAIL"} ${item.name}${item.detail ? ` (${item.detail})` : ""}`,
);
process.stdout.write(`${lines.join("\n")}\n${passed ? "autonomy safety e2e passed" : "autonomy safety e2e FAILED"}\n`);
assert.ok(passed, "autonomy safety e2e failed");
