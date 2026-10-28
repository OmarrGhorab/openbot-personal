// Proves that an agent checks its own work before it reports it done. It runs in this worktree's
// running dev app, through the real preload bridge, IPC, agent service and provider:
// `bun scripts/self-check-e2e.ts --allow-mutations --agent=<agent id>`. Start the app first with
// `bun run dev` (never `--shared`), and pass an agent whose provider is signed in and runs a turn.
//
// The script writes a small fixture into the agent workspace, with one bug that its check finds.
// It sets the agent's definition of done to that check, and asks the agent to call `openbot.mark_done`
// before it changes anything. The check must fail, and the chat must show the failure. Then the agent
// fixes the bug and calls `openbot.mark_done` again, and the chat must show a pass after the failure.
// The script then runs the check itself, and restores the agent and removes the fixture.
//
// Each turn is a real provider turn, and it adds messages to the agent's chat. Writes
// .openbot-build/self-check-e2e/report.json.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type AgentSummary,
  type ClientAgentSummary,
  type ConversationMessage,
  DONE_CHECK_FAILED_ITEM_TYPE,
  DONE_CHECK_PASSED_ITEM_TYPE,
  isAgentSummary,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const execFileAsync = promisify(execFile);
const OUT = resolve(import.meta.dirname, "../.openbot-build/self-check-e2e");
const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;

/** The folder of the fixture, inside the agent workspace so that every access level can write it. */
const FIXTURE_FOLDER = ".openbot-self-check";
/** The command that the definition of done runs, relative to the agent workspace. */
const CHECK_COMMAND = `node ${FIXTURE_FOLDER}/check.mjs`;
/** A model turn with two checks and a fix can take a few minutes. */
const TURN_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 2_000;

const ADD_WITH_BUG = "export function add(a, b) {\n  return a - b;\n}\n";
const CHECK_SOURCE = [
  'import { add } from "./add.mjs";',
  "",
  "if (add(2, 3) !== 5) {",
  '  console.error("add(2, 3) must return 5");',
  "  process.exit(1);",
  "}",
  'console.log("check passed");',
  "",
].join("\n");

interface Report {
  agentId: string;
  provider?: string;
  checkCommand: string;
  cardSequence?: string[];
  cardTexts?: Array<{ itemType: string; text: string }>;
  finalCheckExitCode?: number;
  restored?: { definitionOfDone: string[] };
  passed: boolean;
}

const report: Report = { agentId, checkCommand: CHECK_COMMAND, passed: false };

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "self-check-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("self-check-e2e"), {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;

async function readAgent(): Promise<AgentSummary> {
  const agent = await page.evaluate(async (id) => {
    const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Unknown agent: ${id}`);
    return found;
  }, agentId);
  if (!isAgentSummary(agent)) throw new Error(`The agent ${agentId} has a provider that this build does not know.`);
  return agent;
}

function setDefinitionOfDone(commands: string[] | null): Promise<ClientAgentSummary> {
  return page.evaluate(({ id, value }) => window.openbot.agent.updateAgent({ agentId: id, definitionOfDone: value }), {
    id: agentId,
    value: commands,
  });
}

async function readMessages(): Promise<{ messages: ConversationMessage[]; activeTurnId: string | null }> {
  const snapshot = await page.evaluate((id) => window.openbot.agent.readConversation(id), agentId);
  return { messages: snapshot.messages, activeTurnId: snapshot.activeTurnId };
}

const PROMPT = [
  `Read ${FIXTURE_FOLDER}/add.mjs and ${FIXTURE_FOLDER}/check.mjs in your workspace.`,
  "Step 1: before you change any file, call openbot.mark_done and say what it returned.",
  `Step 2: fix the bug in ${FIXTURE_FOLDER}/add.mjs. Do not edit ${FIXTURE_FOLDER}/check.mjs.`,
  "Step 3: call openbot.mark_done again. Report done only when it returns done.",
  "Keep your answer to two sentences. Do not use other tools.",
].join("\n");

async function waitForAnswer(afterCount: number): Promise<ConversationMessage[]> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  for (;;) {
    const { messages, activeTurnId } = await readMessages();
    const answered = messages
      .slice(afterCount)
      .some((message) => message.author === "assistant" && message.status === "completed");
    if (answered && activeTurnId === null) return messages;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the agent to finish its turn.");
    await page.waitForTimeout(POLL_MS);
  }
}

const before = await readAgent();
report.provider = before.provider;
const originalChecks = before.definitionOfDone ?? [];
const workspace = before.workspacePath;
assert.ok(workspace, "The agent has no workspace folder.");
const fixture = join(workspace, FIXTURE_FOLDER);

try {
  const initial = await readMessages();
  assert.equal(initial.activeTurnId, null, "The agent is busy. Wait for its turn to end and run again.");
  const afterCount = initial.messages.length;

  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, "add.mjs"), ADD_WITH_BUG);
  writeFileSync(join(fixture, "check.mjs"), CHECK_SOURCE);
  await setDefinitionOfDone([CHECK_COMMAND]);

  await page.evaluate(
    ({ id, text }) => window.openbot.agent.sendMessage({ agentId: id, text, clientMessageId: crypto.randomUUID() }),
    { id: agentId, text: PROMPT },
  );
  const messages = await waitForAnswer(afterCount);

  const cards = messages
    .slice(afterCount)
    .filter(
      (message) => message.itemType === DONE_CHECK_FAILED_ITEM_TYPE || message.itemType === DONE_CHECK_PASSED_ITEM_TYPE,
    );
  report.cardSequence = cards.map((message) => message.itemType ?? "");
  report.cardTexts = cards.map((message) => ({ itemType: message.itemType ?? "", text: message.text }));

  // The gate must show a failure first, then a pass: a pass alone would mean the agent never saw the bug.
  const failedAt = report.cardSequence.indexOf(DONE_CHECK_FAILED_ITEM_TYPE);
  const passedAt = report.cardSequence.lastIndexOf(DONE_CHECK_PASSED_ITEM_TYPE);
  assert.ok(failedAt >= 0, `No failed check note in the chat. Notes: ${JSON.stringify(report.cardSequence)}`);
  assert.ok(
    passedAt > failedAt,
    `No passed check note after the failure. Notes: ${JSON.stringify(report.cardSequence)}`,
  );
  const failedCard = cards[failedAt];
  assert.ok(failedCard?.text.includes(CHECK_COMMAND), "The failed note does not name the check command.");

  // The script runs the check itself: the agent's claim is not the evidence.
  const check = await execFileAsync("node", [join(FIXTURE_FOLDER, "check.mjs")], { cwd: workspace }).then(
    () => 0,
    (error: { code?: unknown }) => (typeof error.code === "number" ? error.code : 1),
  );
  report.finalCheckExitCode = check;
  assert.equal(check, 0, "The check still fails after the agent reported done.");
  report.passed = true;
} finally {
  await setDefinitionOfDone(originalChecks.length > 0 ? originalChecks : null);
  rmSync(fixture, { recursive: true, force: true });
  const restored = await readAgent();
  report.restored = { definitionOfDone: restored.definitionOfDone ?? [] };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
