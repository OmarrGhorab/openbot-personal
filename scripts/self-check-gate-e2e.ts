// Drives the done gate of `openbot.mark_done` with real shell commands and real fixture folders.
// It calls the real `AgentDoneChecks` class, which runs each command through the shell of this
// computer, and it fakes only the agent store and the task lookup. It needs no desktop app, no
// provider and no model, so it runs where the desktop app cannot start:
// `bun scripts/self-check-gate-e2e.ts`. The app-level check is `scripts/self-check-e2e.ts`.
//
// It proves four things: a failing check blocks done and the chat shows the failure; the same check
// passes after a fix and the chat shows the pass; a reviewer adds one round before done; a secret in
// a command's output never reaches the agent or the chat. Writes
// .openbot-build/self-check-gate-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type AgentSummary,
  DONE_CHECK_FAILED_ITEM_TYPE,
  DONE_CHECK_PASSED_ITEM_TYPE,
  DONE_CHECK_REVIEW_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { AgentDoneChecks, type DoneCheckCard } from "../src/backend/agent/agent-done-checks";
import type { OpenBotToolResponse } from "../src/backend/agent/routine-tools";
import type { DynamicToolCallParams } from "../src/backend/protocol";
import { isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/self-check-gate-e2e");
const WORK = join(OUT, "work");
const WORKTREE = join(OUT, "worktree");
const SECRET = "sk-gate-e2e-SECRET-0123456789";

const ADD_WITH_BUG = "export function add(a, b) {\n  return a - b;\n}\n";
const ADD_FIXED = "export function add(a, b) {\n  return a + b;\n}\n";
const CHECK_SOURCE = [
  'import { add } from "./add.mjs";',
  "if (add(2, 3) !== 5) {",
  '  console.error("add(2, 3) must return 5");',
  "  process.exit(1);",
  "}",
  'console.log("check passed");',
  "",
].join("\n");

function agent(id: string, overrides: Partial<AgentSummary>): AgentSummary {
  return {
    id,
    name: id,
    title: "",
    description: "",
    notifications: false,
    provider: "claude",
    model: "gate-e2e-model",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: WORK,
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
    ...overrides,
  };
}

const CHECK = "node add-check.mjs";
const SECRET_CHECK = `node -e "console.log('api_key=${SECRET}'); process.exit(3)"`;
const agents: AgentSummary[] = [
  agent("author", { definitionOfDone: [CHECK] }),
  agent("secret", { definitionOfDone: [SECRET_CHECK] }),
  agent("reviewed", { definitionOfDone: [CHECK], reviewerAgentId: "reviewer" }),
  agent("reviewer", {}),
  agent("unchecked", {}),
  agent("task-owner", { definitionOfDone: [CHECK] }),
];

const cards: Array<DoneCheckCard & { agentId: string; threadId: string }> = [];
const taskOfThread = new Map<string, string>([["task-thread", "task-1"]]);
const worktreeOfTask = new Map<string, { mode: "worktree"; path: string; branch: string }>([
  ["task-1", { mode: "worktree", path: WORKTREE, branch: "openbot/task-1" }],
]);
const shared: { mode: "shared" } = { mode: "shared" };

const checks = new AgentDoneChecks({
  store: { list: () => agents },
  tasks: {
    taskForThread: (threadId) => taskOfThread.get(threadId) ?? null,
    workspace: (taskId) => worktreeOfTask.get(taskId) ?? shared,
  },
  postCard: (agentId, threadId, turnId, card) => {
    cards.push({ ...card, agentId, threadId });
    assert.ok(turnId.length > 0);
  },
});

let callNumber = 0;
async function markDone(agentId: string, threadId: string, args: { reviewRound?: number } = {}) {
  callNumber += 1;
  const params: DynamicToolCallParams = {
    threadId,
    turnId: `turn-${callNumber}`,
    callId: `call-${callNumber}`,
    namespace: "openbot",
    tool: "mark_done",
    arguments: args,
  };
  const response: OpenBotToolResponse | null = await Effect.runPromise(checks.handleTool(params, agentId, threadId));
  assert.ok(response, "mark_done did not answer");
  const item = response.contentItems[0];
  assert.ok(item && "text" in item, "mark_done answered without text");
  const parsed = JSON.parse(item.text);
  assert.ok(isRecord(parsed), "mark_done answered with a value that is not an object");
  return { success: response.success, body: parsed, text: item.text };
}

const steps: Array<{ name: string; passed: boolean; detail: string }> = [];
function step(name: string, detail: string, check: () => void) {
  try {
    check();
    steps.push({ name, passed: true, detail });
  } catch (error) {
    steps.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(WORKTREE, { recursive: true });
for (const folder of [WORK, WORKTREE]) {
  writeFileSync(join(folder, "add.mjs"), ADD_WITH_BUG);
  writeFileSync(join(folder, "add-check.mjs"), CHECK_SOURCE);
}

const report: { passed: boolean; steps: typeof steps } = { passed: false, steps };
try {
  // 1. The failing check blocks done, and the chat shows the failure with the output.
  const blocked = await markDone("author", "main-thread");
  step("a failing check blocks done", "status blocked", () => {
    assert.equal(blocked.success, true);
    assert.equal(blocked.body.status, "blocked");
    assert.ok(blocked.text.includes("must return 5"), "the failing output is missing from the result");
    assert.equal(cards.at(-1)?.itemType, DONE_CHECK_FAILED_ITEM_TYPE);
    assert.ok(cards.at(-1)?.text.includes(CHECK), "the failed note does not name the check");
  });

  // 2. After the fix, the same check passes, and the chat shows the pass after the failure.
  writeFileSync(join(WORK, "add.mjs"), ADD_FIXED);
  const done = await markDone("author", "main-thread");
  step("a passing check after a fix reports done", "status done, pass note after the failure", () => {
    assert.equal(done.body.status, "done");
    const types = cards.map((card) => card.itemType);
    assert.deepEqual(types, [DONE_CHECK_FAILED_ITEM_TYPE, DONE_CHECK_PASSED_ITEM_TYPE]);
  });

  // 3. Output that contains a secret never reaches the agent or the chat.
  const secret = await markDone("secret", "main-thread");
  step("a secret in check output is redacted", "no secret text in result or card", () => {
    assert.equal(secret.body.status, "blocked");
    assert.equal(secret.text.includes(SECRET), false, "the secret reached the agent");
    assert.equal(
      cards.some((card) => card.text.includes(SECRET)),
      false,
      "the secret reached the chat",
    );
  });

  // 4. A reviewer asks for one review round first; the round then ends the gate.
  const awaitingReview = await markDone("reviewed", "main-thread");
  step("a reviewer adds one round before done", "review_required, then done with round 1", () => {
    assert.equal(awaitingReview.body.status, "review_required");
    assert.ok(awaitingReview.text.includes("reviewer"), "the review note names no reviewer");
  });
  const reviewCard = cards.at(-1);
  step("the chat card says the work waits for review", "a review card that names the reviewer", () => {
    assert.equal(reviewCard?.itemType, DONE_CHECK_REVIEW_ITEM_TYPE);
    assert.ok(reviewCard?.text.includes("waiting for review by"), "the review card reads as done");
  });
  const reviewed = await markDone("reviewed", "main-thread", { reviewRound: 1 });
  step("a review round of one ends the gate", "status done with round 1", () => {
    assert.equal(reviewed.body.status, "done");
    assert.equal(cards.at(-1)?.itemType, DONE_CHECK_PASSED_ITEM_TYPE, "the last round does not show done");
  });

  // 5. An agent without checks is done, and the note says that no check ran.
  const unchecked = await markDone("unchecked", "main-thread");
  step("no checks set: done with a note", "status done, no note", () => {
    assert.equal(unchecked.body.status, "done");
    assert.ok(String(unchecked.body.note).includes("No checks are set"));
  });

  // 6. A task runs its checks in its own worktree, not in the agent workspace.
  writeFileSync(join(WORKTREE, "add.mjs"), ADD_FIXED);
  const taskDone = await markDone("task-owner", "task-thread");
  step("a task runs its checks in its worktree", "status done in the worktree", () => {
    assert.equal(taskDone.body.status, "done");
    assert.equal(cards.at(-1)?.threadId, "task-thread");
  });
  // The agent workspace still has the bug: the task check passed only in the worktree.
  writeFileSync(join(WORK, "add.mjs"), ADD_WITH_BUG);
  const workspaceCheck = await markDone("task-owner", "main-thread");
  step("the agent workspace is checked on its own", "status blocked in the workspace", () => {
    assert.equal(workspaceCheck.body.status, "blocked");
  });

  // 7. Arguments outside the schema are a tool failure, and another tool is not answered.
  const invalid = await markDone("author", "main-thread", { reviewRound: 9 });
  step("a review round above the limit is refused", "tool failure", () => {
    assert.equal(invalid.success, false);
  });
  const other = await Effect.runPromise(
    checks.handleTool(
      { threadId: "main-thread", turnId: "t", callId: "c", namespace: "openbot", tool: "send_message", arguments: {} },
      "author",
      "main-thread",
    ),
  );
  step("other tools are not answered", "null", () => {
    assert.equal(other, null);
  });

  report.passed = steps.every((item) => item.passed);
} finally {
  rmSync(WORKTREE, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
