// Checks project memory across two work threads of one agent. The real agent service, tool router and
// project memory store run on a temporary profile. A fake Codex app-server stands in for the provider:
// it logs the developer instructions of each thread it starts, and it calls a tool through `tool_call`
// when a message holds `MEMORY-CALL <<ARGS{json}ARGS>>`. No model runs, so this check does not show how a
// model uses a memory; it shows what each thread receives and what the tools save and return.
// The check asserts that a lesson saved in the chat (thread 1) is in the project block of a new work
// thread (thread 2) and comes back from `search_project_memory`; that the user sees who saved it; that a
// secret is redacted before the save; and that edit, delete and undo restore each change.
// `bun scripts/agent-memory-e2e.ts`. Writes .openbot-build/agent-memory-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { databaseRows, requiredStringColumn } from "../src/backend/database/database-rows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-memory-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-agent-memory-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const CALL_MARK = "MEMORY-CALL";
const LESSON = "Run bun run test:changed before you push.";
const SECRET = "E2E-SECRET-VALUE-42";
const MODEL = "gpt-6-luna";

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

/**
 * A Codex app-server with the methods that the service calls. It logs `thread/start` with the developer
 * instructions of the new thread, and each tool result by turn. A turn whose input holds the call mark
 * calls the tool that its JSON names; other turns answer "Done.".
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
/** Tool request id -> the turn that waits for its result. */
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId) => {
  const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: ${JSON.stringify(MODEL)}, displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": {
      const threadId = "thread-" + process.pid + "-" + (++threads);
      log({ kind: "thread/start", threadId, developerInstructions: params.developerInstructions ?? null });
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
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const match = text.includes(${JSON.stringify(CALL_MARK)}) ? /<<ARGS([\\s\\S]*?)ARGS>>/.exec(text) : null;
      if (!match) return setTimeout(() => finish(params.threadId, turnId), 20);
      const id = "tool-" + turnId;
      waiting.set(id, { threadId: params.threadId, turnId });
      const { __tool, ...args } = JSON.parse(match[1]);
      return write({
        id,
        method: "item/tool/call",
        params: {
          threadId: params.threadId,
          turnId,
          callId: "call-" + turnId,
          namespace: "openbot",
          tool: "tool_call",
          arguments: { name: "openbot." + __tool, arguments: args },
        },
      });
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
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        log({ turnId: turn.turnId, result: message.result ?? null, error: message.error ?? null });
        finish(turn.threadId, turn.turnId);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

/** The arguments of the two tools the check calls: a lesson to save, or a query to search for. */
type ToolArgs =
  | { readonly kind: "command" | "rule" | "decision" | "known-problem"; readonly text: string }
  | { readonly query: string }
  | { readonly failure: string; readonly rule: string };

interface ToolResult {
  success: boolean;
  contentItems: { type: string; text: string }[];
}

interface FakeLogEntry {
  kind?: string;
  developerInstructions?: string | null;
  turnId?: string;
  result?: ToolResult | null;
  error?: unknown;
}

interface Step {
  name: string;
  passed: boolean;
}

const report: {
  model: string;
  passed: boolean;
  checks: Step[];
  calls: { name: string; success: boolean; text: string }[];
  stored: { kind: string; text: string }[];
  unverified: string[];
  error?: string;
} = {
  model: "none. A scripted Codex app-server stands in for the provider; no model runs.",
  passed: false,
  checks: [],
  calls: [],
  stored: [],
  unverified: [
    "A model that reads the project block and acts on it. No free model is reachable from this check.",
    "The limit of project memory entries, and the summary at thread start for a project past the byte budget.",
    "The dev-automation screenshots of the settings panel. They are recorded separately.",
  ],
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

/** Waits for a state of the service or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function fakeEntries(): FakeLogEntry[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pass(name: string, condition: boolean, detail?: string): void {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

/** Sends a chat message that makes the fake call the tool, and returns the result it logged. */
async function callTool(
  name: string,
  agentId: string,
  tool: string,
  args: ToolArgs,
  agents: InstanceType<typeof AgentService>,
  mailbox: InstanceType<typeof MailboxStore>,
): Promise<{ success: boolean; text: string }> {
  const receipt = await runCauseEffect(
    agents.sendMessage({ agentId, text: `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: tool, ...args })}ARGS>>` }),
  );
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${name}: no delivery`);
  const turnId = await waitFor(`${name} turn`, () => mailbox.getDelivery(deliveryId)?.delivery.turnId);
  const entry = await waitFor(`${name} tool result`, () => fakeEntries().find((line) => line.turnId === turnId));
  const success = entry.result?.success === true;
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  report.calls.push({ name, success, text });
  return { success, text };
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

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Memory",
      description: "Learns the project.",
      avatarSeed: "memory",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor("the first chat turn to end", () => idle(agent.id));

  // Thread 1: the agent's chat saves a lesson with save_lesson.
  const saved = await callTool(
    "save a lesson in thread 1",
    agent.id,
    "save_lesson",
    { kind: "command", text: LESSON },
    agents,
    mailbox,
  );
  pass("thread 1 saves the lesson", saved.success && saved.text.includes('"status":"saved"'), saved.text);

  // Redaction: a secret in the lesson is replaced before the save.
  const secret = await callTool(
    "save a lesson with a secret",
    agent.id,
    "save_lesson",
    { kind: "rule", text: `Use api_key=${SECRET} for the staging tests.` },
    agents,
    mailbox,
  );
  pass("a lesson with a secret is still saved", secret.success, secret.text);
  const rows = databaseRows(
    database.connection.prepare("SELECT kind, text FROM project_memories ORDER BY rowid").all(),
  ).map((row) => ({ kind: requiredStringColumn(row, "kind"), text: requiredStringColumn(row, "text") }));
  report.stored = rows;
  pass(
    "no stored memory holds the secret",
    rows.every((row) => !row.text.includes(SECRET)),
    JSON.stringify(rows),
  );
  pass(
    "the stored secret is replaced by a redaction marker",
    rows.some((row) => row.text.includes("[redacted]")),
  );

  // Who saved what: the lesson of the chat names the agent; the user sees the same.
  const state = agents.getProjectMemories(agent.id);
  const lesson = state.memories.find((memory) => memory.text === LESSON);
  pass("the lesson names the agent that saved it", lesson?.savedByAgentId === agent.id, JSON.stringify(lesson));
  pass("the project folder is the agent workspace", state.projectPath === resolveWorkspace(agent.id));

  // Thread 2: a new work thread of the same agent searches the project memory.
  await runCauseEffect(
    agents.startTask({
      agentId: agent.id,
      text: `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: "search_project_memory", query: "test:changed" })}ARGS>>`,
    }),
  );
  const found = await waitFor("the search result of thread 2", () =>
    fakeEntries().find((line) => line.result?.contentItems.some((item) => item.text.includes(LESSON))),
  );
  const searchText = found.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  report.calls.push({ name: "search from thread 2", success: found.result?.success === true, text: searchText });
  pass("thread 2 finds the lesson of thread 1", found.result?.success === true && searchText.includes(LESSON));

  // The developer instructions of each started thread: thread 1 began before the lesson, thread 2 after.
  const starts = fakeEntries().filter((line) => line.kind === "thread/start");
  const firstThread = starts[0]?.developerInstructions ?? "";
  const secondThread = starts.at(-1)?.developerInstructions ?? "";
  pass("two threads started", starts.length >= 2, `${starts.length} thread starts`);
  pass("thread 1 started without the lesson", !firstThread.includes(LESSON));
  pass(
    "thread 2 starts with the lesson in its project block",
    secondThread.includes('<openbot_project_memory count="2"') && secondThread.includes(LESSON),
  );
  pass("the secret is not in the instructions of thread 2", !secondThread.includes(SECRET));

  // An exact duplicate is not saved twice; a failed check becomes a known problem with its rule.
  const duplicate = await callTool(
    "save the same lesson again",
    agent.id,
    "save_lesson",
    { kind: "command", text: LESSON },
    agents,
    mailbox,
  );
  pass(
    "an exact duplicate is not saved twice",
    duplicate.success && duplicate.text.includes('"unchanged"'),
    duplicate.text,
  );
  const failure = await callTool(
    "learn from a failure",
    agent.id,
    "learn_from_failure",
    { failure: "CI lint fails on an unused export", rule: "Run knip before you push." },
    agents,
    mailbox,
  );
  pass(
    "a failure is saved as a known problem",
    failure.success && failure.text.includes('"known-problem"'),
    failure.text,
  );
  pass(
    "the known problem names the failure and the rule",
    agents
      .getProjectMemories(agent.id)
      .memories.some(
        (memory) =>
          memory.kind === "known-problem" &&
          memory.text === "Problem: CI lint fails on an unused export. Rule: Run knip before you push.",
      ),
  );

  // User control: edit, undo; delete, undo; a second undo has nothing to undo.
  const edited = agents.updateProjectMemory({
    agentId: agent.id,
    memoryId: lesson?.id ?? "",
    kind: "rule",
    text: "Run bun run test:changed before every push.",
  });
  const afterEdit = edited.memories.find((memory) => memory.id === lesson?.id);
  pass("the user edits an entry", afterEdit?.kind === "rule" && afterEdit.updatedByAgentId === null);
  pass("the edit is the last change", edited.undo?.action === "update");
  const undoneEdit = agents.undoProjectMemory(agent.id);
  const restored = undoneEdit.memories.find((memory) => memory.id === lesson?.id);
  pass("undo restores the text and the kind", restored?.text === LESSON && restored.kind === "command");

  const deleted = agents.deleteProjectMemory({ agentId: agent.id, memoryId: lesson?.id ?? "" });
  pass("the user deletes an entry", !deleted.memories.some((memory) => memory.id === lesson?.id));
  const undoneDelete = agents.undoProjectMemory(agent.id);
  pass(
    "undo brings the deleted entry back",
    undoneDelete.memories.some((memory) => memory.id === lesson?.id),
  );
  pass("no second undo is left", undoneDelete.undo === null);
  assert.throws(() => agents.undoProjectMemory(agent.id), /no project memory change/i);
  report.checks.push({ name: "a second undo is refused", passed: true });

  report.passed = report.checks.every((check) => check.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}

function resolveWorkspace(agentId: string): string {
  const found = store.list().find((candidate) => candidate.id === agentId);
  assert.ok(found, "The agent is missing.");
  return resolve(found.workspacePath);
}
