// Checks that a provider error moves an agent set to switch without asking to its next backup model,
// and that read_agent shows the move (#2834). Runs the real agent service on a temporary profile. Claude is the real `ClaudeAgentClient`,
// which the Claude Agent SDK connects to a stand-in `claude` executable. The stand-in answers each
// message on its current model, and fails it with the CLI's report of an Anthropic overload (529)
// when that model is in `failing.json`. A message with `act-then-fail` writes text before it fails.
// Checks:
//   1. A turn that wrote text before the error moves to the backup model once, with a handoff of its partial answer.
//   2. An agent set to ask first keeps the error of a turn that wrote text, and does not move.
//   3. An agent with no backup models fails with its error, as before.
//   4. A turn that did nothing yet runs again on the backup model, with a note and no error.
//   5. A 429 rate limit and an insufficient quota error both move a turn that wrote text, with a handoff.
//   6. A plan window that stops a turn after it wrote text moves it to the backup, with a handoff.
//   7. When the backup fails too, the turn fails once with its error and does not loop.
//   8. read_agent shows the backup model, and the model to go back to with the provider error as cause.
//   9. After a restart, the agent goes back to its own model, with a note.
// `bun run test:backup-model-failover`. Writes .openbot-build/backup-model-failover-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  type AgentModelId,
  defaultProviderModel,
  MODEL_SWITCH_ITEM_TYPES,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { classifyFailure } from "../packages/telemetry/src/events";
import { usageLimitAskBodyKey } from "../packages/ui/src/features/conversation/usage-limit-copy";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/backup-model-failover-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-backup-model-failover-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const turnLog = join(root, "claude-turns.jsonl");
const failingFile = join(root, "failing.json");
// One line per tool run of the stand-in, so a repeated run of a tool shows as a second line.
const effectsFile = join(root, "effects.log");
const claudeExecutable = join(root, "claude");
const PRIMARY: AgentModelId = defaultProviderModel("claude");
const BACKUP: AgentModelId = PRIMARY === "claude-sonnet-5-5" ? "claude-opus-5-5" : "claude-sonnet-5-5";
// The text the Claude CLI writes in an outage. It names no HTTP status phrase, only the 529 and its type.
const PROVIDER_ERROR =
  'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_e2e"}';
const RATE_LIMIT_ERROR =
  'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"},"request_id":"req_e2e"}';
const QUOTA_ERROR =
  'API Error: 402 insufficient quota {"type":"error","error":{"type":"insufficient_quota","message":"Quota exceeded"},"request_id":"req_e2e"}';
// A plan window: the provider names its reset, and the limit holds the agent's queue until then.
const PLAN_LIMIT_ERROR = "API Error: 429 You've hit your session limit · resets 5pm";
const ERRORS: Record<string, string> = {
  "429": RATE_LIMIT_ERROR,
  quota: QUOTA_ERROR,
  limit: PLAN_LIMIT_ERROR,
  overload: PROVIDER_ERROR,
};

// Before the service modules load: the stores and the CLI search read these.
process.env.HOME = home;
// Claude's transcripts are read from this directory, so the check never reads the user's own config.
process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

// The stand-in for the Claude CLI. It speaks enough of the stream-json protocol for a turn to end,
// and logs the model and the outcome of each turn.
const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.302 (Claude Code)\\n");
  process.exit(0);
}
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index < 0) return null;
  return args[index] === name ? (args[index + 1] ?? null) : args[index].slice(name.length + 1);
};
const sessionId = option("--resume") ?? option("--session-id") ?? randomUUID();
let model = option("--model");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const result = (fields) =>
  write({ type: "result", subtype: "success", session_id: sessionId, uuid: randomUUID(), duration_ms: 1,
    duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 },
    permission_denials: [], modelUsage: {}, ...fields });
// The transcript goes where the client reads it: CLAUDE_CONFIG_DIR of the agent, or the default config directory.
const transcriptDir = (process.env.CLAUDE_CONFIG_DIR ?? ${JSON.stringify(join(home, ".claude"))}) + "/projects/e2e-project";
const effectsFile = ${JSON.stringify(effectsFile)};
// The session transcript the Claude client reads its work steps from.
// Each record names the one before it, as Claude's transcript does, so the reader finds the conversation.
const record = (value) => {
  fs.mkdirSync(transcriptDir, { recursive: true });
  const file = transcriptDir + "/" + sessionId + ".jsonl";
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\\n").filter(Boolean) : [];
  const parentUuid = lines.length ? JSON.parse(lines[lines.length - 1]).uuid : null;
  fs.appendFileSync(file, JSON.stringify({ uuid: randomUUID(), parentUuid, sessionId, timestamp: new Date().toISOString(), ...value }) + "\\n");
};
// The text of a user message: its string content, or the text of its blocks.
const userText = (content) =>
  typeof content === "string" ? content : (Array.isArray(content) ? content.map((block) => block.text ?? "").join("\\n") : "");
const assistantBlocks = (content) => {
  write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model, content,
    stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
  record({ type: "assistant", message: { role: "assistant", model, content } });
};
const assistant = (text) => assistantBlocks([{ type: "text", text }]);
const turn = (message) => {
  const failing = JSON.parse(fs.readFileSync(${JSON.stringify(failingFile)}, "utf8"));
  const entry = failing.find((item) => item.split("|")[0] === model);
  const fails = entry !== undefined;
  const errors = ${JSON.stringify(ERRORS)};
  const kind = entry?.split("|")[1] ?? "overload";
  const body = JSON.stringify(message);
  const acts = body.includes("act-then-fail");
  // A turn that asks for a tool runs it, unless its prompt already holds the work steps of an earlier
  // attempt. A model that reads those steps does not run the tool again.
  const runsTool = body.includes("use-tool") && !body.includes("[work steps]");
  fs.appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify({ model, failed: fails, prompt: body }) + "\\n");
  // The user record keeps the uuid that OpenBot sent: the reader names the turn by it, as the CLI does.
  record({ ...(message.uuid ? { uuid: message.uuid } : {}), type: "user", message: { role: "user", content: userText(message.message?.content) } });
  if (runsTool) {
    const id = "toolu_e2e_" + randomUUID().slice(0, 8);
    fs.appendFileSync(effectsFile, "run\\n");
    assistantBlocks([{ type: "tool_use", id, name: "Bash", input: { command: "e2e-effect" } }]);
    const toolResult = [{ type: "tool_result", tool_use_id: id, content: "ok" }];
    write({ type: "user", message: { role: "user", content: toolResult }, parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
    record({ type: "user", message: { role: "user", content: toolResult } });
  }
  if (fails) {
    if (acts) assistant("Partial answer.");
    result({ is_error: true, result: errors[kind] });
    return;
  }
  assistant("Done.");
  result({ is_error: false, result: "Done." });
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === "control_request") {
      if (message.request?.subtype === "set_model") model = message.request.model ?? model;
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    } else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/**
 * The real Claude client. Only the account, usage and model reads are answered here: the real ones
 * run `claude auth status` or a probe query. It also records the provider thread of the last turn, and
 * keeps the answers to the tool calls this check sends as the provider would.
 */
class ClaudeStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;
  /** The provider thread of the last turn that started. */
  lastThread: string | null = null;
  readonly toolAnswers = new Map<RequestId, unknown>();

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => {
      if (notification.method === "turn/started" && isDynamicRecord(notification.params)) {
        const threadId = notification.params.threadId;
        if (typeof threadId === "string") this.lastThread = threadId;
      }
      this.emit("notification", notification);
    });
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
    this.#real.on("exit", (error) => this.emit("exit", error));
  }

  get running(): boolean {
    return this.#real.running;
  }

  start(): void {
    this.#real.start();
  }

  stop() {
    return this.#real.stop();
  }

  canReleaseProcess = () => this.#real.canReleaseProcess();

  releaseThread(externalThreadId: string) {
    return this.#real.releaseThread(externalThreadId);
  }

  releaseIdleThreads() {
    return this.#real.releaseIdleThreads();
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    if (!this.#real.running) return this.#real.request(method, params, decoder, timeoutMs);
    switch (method) {
      case "account/read":
        return providerSync(() => decoder({ account: { type: "claude", email: "claude@example.com" } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() =>
          decoder({
            data: [
              { model: PRIMARY, displayName: "Primary" },
              { model: BACKUP, displayName: "Backup" },
            ],
          }),
        );
      default:
        return this.#real.request(method, params, decoder, timeoutMs);
    }
  }

  notify(): void {
    this.#real.notify();
  }

  respond(id: RequestId, result: unknown): void {
    if (typeof id === "string" && id.startsWith("e2e-tool-")) this.toolAnswers.set(id, result);
    else this.#real.respond(id, result);
  }

  respondError(id: RequestId, error: Parameters<AgentClient["respondError"]>[1]): void {
    if (typeof id === "string" && id.startsWith("e2e-tool-")) this.toolAnswers.set(id, { error });
    else this.#real.respondError(id, error);
  }
}

interface Check {
  name: string;
  passed: boolean;
  detail?: unknown;
}

const report: { primary: string; backup: string; checks: Check[]; passed: boolean; error?: string } = {
  primary: PRIMARY,
  backup: BACKUP,
  checks: [],
  passed: false,
};

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

/** Waits for a state of the service or of its database. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function turns(): { model: string; failed: boolean; prompt?: string }[] {
  try {
    return readFileSync(turnLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const failing = (models: string[]) => writeFileSync(failingFile, JSON.stringify(models));

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
failing([]);
const database = new OpenBotDatabase(userData);
const clients: ClaudeStandIn[] = [];
const events: AgentEvent[] = [];

function startService() {
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "claude",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
    clientFactory: (_provider, cli) => {
      const client = new ClaudeStandIn(cli);
      clients.push(client);
      return client;
    },
  });
  service.on("event", (event) => events.push(event));
  return { store, mailbox, service };
}

let { store, mailbox, service } = startService();

function agentOf(agentId: string) {
  const agent = store.list().find((candidate) => candidate.id === agentId);
  assert.ok(agent, `Agent ${agentId} exists.`);
  return agent;
}

function errorsFor(agentId: string, since: number) {
  return events.slice(since).filter((event) => event.type === "error" && event.agentId === agentId);
}

/** Sends a message and waits for its delivery to end. */
async function send(agentId: string, text: string) {
  const receipt = await runCauseEffect(service.sendMessage({ agentId, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "The message has a delivery.");
  const status = await waitFor(`"${text}" to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" ? value : null;
  });
  return { status, error: mailbox.getDelivery(deliveryId)?.delivery.error ?? null };
}

/** The name the service lists for a model, which the switch notes show. */
function modelName(model: string): string {
  return service.listModels().find((option) => option.provider === "claude" && option.id === model)?.name ?? model;
}

async function markers(agentId: string, itemType: string) {
  const snapshot = await runCauseEffect(service.readConversation(agentId));
  return snapshot.messages.filter((message) => message.itemType === itemType).map((message) => message.text);
}

/** Calls an OpenBot tool from the thread of the last turn, as its provider would, and returns the answer. */
let toolCalls = 0;
async function callTool(tool: string, args: unknown) {
  const client = clients.at(-1);
  assert.ok(client, "The service made a Claude client.");
  const thread = client.lastThread;
  assert.ok(thread, "A turn ran.");
  const id = `e2e-tool-${++toolCalls}`;
  client.emit("request", {
    id,
    method: "item/tool/call",
    params: { threadId: thread, turnId: "e2e-turn", callId: id, namespace: "openbot", tool, arguments: args },
  });
  const answer = await waitFor(`${tool} to answer`, () => client.toolAnswers.get(id));
  assert.ok(isDynamicRecord(answer) && Array.isArray(answer.contentItems), `${tool} answers with content.`);
  const item = answer.contentItems[0];
  assert.ok(isDynamicRecord(item) && typeof item.text === "string", `${tool} answers with text.`);
  return { success: answer.success === true, text: item.text };
}

/** How many tool runs the stand-in made so far. */
function effectRuns(): number {
  try {
    return readFileSync(effectsFile, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Stops the service and starts it again with these models failing. A provider error holds its model
 * for ten minutes in memory, so each check that needs its own model free starts from a restart.
 */
async function restart(models: string[]) {
  await runCauseEffect(service.stop());
  failing(models);
  ({ store, mailbox, service } = startService());
  await runCauseEffect(service.initialize());
}

async function check(name: string, run: () => Promise<unknown>) {
  const detail = await run();
  report.checks.push({ name, passed: true, detail });
}

try {
  // Each sample is the text a provider reports for a limit or an outage, as its CLI or API writes it.
  // The cause decides whether a turn moves to a backup model (`FAILOVER_CAUSES`) or waits for a reset.
  await check("limit and outage errors of each provider are classified", async () => {
    const samples: { provider: string; input: unknown; cause: string }[] = [
      {
        provider: "claude",
        input: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}',
        cause: "provider_unavailable",
      },
      {
        provider: "claude",
        input: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
        cause: "rate_limit",
      },
      { provider: "claude", input: "API Error: 402 insufficient quota", cause: "billing" },
      { provider: "claude", input: "You've hit your session limit · resets 5pm", cause: "usage_limit" },
      { provider: "codex", input: { codexErrorInfo: "serverOverloaded" }, cause: "provider_unavailable" },
      { provider: "codex", input: { codexErrorInfo: "rateLimitExceeded" }, cause: "rate_limit" },
      { provider: "codex", input: { codexErrorInfo: "usageLimitExceeded" }, cause: "usage_limit" },
      { provider: "openai", input: "Rate limit reached for gpt. code: rate_limit_exceeded", cause: "rate_limit" },
      {
        provider: "openai",
        input: "Error code: 500 - the server had an error while processing",
        cause: "provider_unavailable",
      },
      { provider: "gemini", input: "429 Too Many Requests", cause: "rate_limit" },
      {
        provider: "gemini",
        input: "503 UNAVAILABLE: The model is overloaded. Please try again later.",
        cause: "provider_unavailable",
      },
    ];
    const mismatches = samples.flatMap((sample) => {
      const actual = classifyFailure(sample.input);
      return actual === sample.cause ? [] : [{ provider: sample.provider, expected: sample.cause, actual }];
    });
    assert.deepEqual(mismatches, [], "Each sample has its expected cause.");
    return { samples: samples.length };
  });

  await runCauseEffect(service.initialize());
  const create = (name: string) =>
    runCauseEffect(
      service.createAgent({
        name,
        description: "Checks backup models.",
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
        provider: "claude",
        model: PRIMARY,
      }),
    );
  const mover = await create("Mover");
  const stayer = await create("Stayer");
  const writer = await create("Writer");
  const asker = await create("Asker");
  const rate = await create("Rate");
  const quota = await create("Quota");
  const exhausted = await create("Exhausted");
  const plan = await create("Plan");
  const tools = await create("Tools");
  const all = [mover, stayer, writer, asker, rate, quota, exhausted, plan, tools];
  await waitFor("the first turns to end", () => {
    const queued = all.some((agent) =>
      service
        .listQueue(agent.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)),
    );
    return turns().length >= all.length && !queued;
  });
  const automatic = (agent: { id: string }) =>
    runCauseEffect(
      service.updateAgent({
        agentId: agent.id,
        backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
      }),
    );
  for (const agent of [mover, writer, rate, quota, exhausted, plan, tools]) await automatic(agent);
  await runCauseEffect(
    service.updateAgent({
      agentId: asker.id,
      backupModels: { automatic: false, order: [{ provider: "claude", model: BACKUP }] },
    }),
  );

  await check("a turn that wrote text moves to the backup model once, with a handoff", async () => {
    failing([PRIMARY]);
    const since = events.length;
    const before = turns().length;
    const outcome = await send(writer.id, "act-then-fail");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message ran once on its own model, then once on the backup.",
    );
    const retry = ran[1]?.prompt ?? "";
    assert.ok(retry.includes("Previous conversation excerpts"), "The backup turn starts with the handoff.");
    assert.ok(retry.includes("Partial answer."), "The handoff keeps the partial answer.");
    assert.equal(agentOf(writer.id).model, BACKUP, "The agent is on the backup model.");
    assert.equal(agentOf(writer.id).usageLimitReturn?.model, PRIMARY, "The agent keeps its own model to go back to.");
    assert.deepEqual(errorsFor(writer.id, since), [], "No error shows for the moved turn.");
    const notes = await markers(writer.id, MODEL_SWITCH_ITEM_TYPES["provider-error"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelSwitchedForError", { model: modelName(BACKUP) })]);
    return { ran: ran.map((turn) => turn.model), notes };
  });

  await check("an agent set to ask first keeps the error of a turn that wrote text", async () => {
    failing([PRIMARY]);
    const since = events.length;
    const before = turns().length;
    const outcome = await send(asker.id, "act-then-fail");
    assert.equal(outcome.status, "failed", "The turn fails.");
    assert.equal(agentOf(asker.id).model, PRIMARY, "The agent stays on its own model.");
    assert.deepEqual(
      turns()
        .slice(before)
        .map((turn) => turn.model),
      [PRIMARY],
      "The turn runs only on the own model.",
    );
    assert.ok(errorsFor(asker.id, since).length > 0, "The error shows.");
    return outcome;
  });

  await check("an agent with no backup models fails as before", async () => {
    failing([PRIMARY]);
    const since = events.length;
    const outcome = await send(stayer.id, "work");
    assert.equal(outcome.status, "failed", "The turn fails.");
    assert.equal(agentOf(stayer.id).model, PRIMARY, "The agent stays on its own model.");
    assert.ok(errorsFor(stayer.id, since).length > 0, "The error shows.");
    return outcome;
  });

  await check("a provider error moves the agent to its backup model", async () => {
    await restart([PRIMARY]);
    const since = events.length;
    const before = turns().length;
    const outcome = await send(mover.id, "work");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message ran on the own model, then on the backup.",
    );
    const agent = agentOf(mover.id);
    assert.equal(agent.model, BACKUP, "The agent is on the backup model.");
    assert.equal(agent.usageLimitReturn?.model, PRIMARY, "The agent keeps its own model to go back to.");
    assert.equal(agent.usageLimitReturn?.cause, "provider-error", "The return names the provider error.");
    assert.deepEqual(errorsFor(mover.id, since), [], "No error shows for the moved turn.");
    const notes = await markers(mover.id, MODEL_SWITCH_ITEM_TYPES["provider-error"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelSwitchedForError", { model: modelName(BACKUP) })]);
    return { ran, notes };
  });

  // Before the restarts below: a restart returns the agent to its own model at once.
  // `agent-profile-accounts-e2e.ts` checks that update_profile sets and clears the order.
  await check("read_agent shows that a provider error moved the agent", async () => {
    const read = await callTool("read_agent", { agentId: mover.id });
    assert.ok(read.success, read.text);
    const setup = JSON.parse(read.text);
    assert.equal(setup.model, BACKUP, "read_agent shows the backup model.");
    assert.equal(setup.usageLimitReturn?.model, PRIMARY, "read_agent names the model to go back to.");
    assert.equal(setup.usageLimitReturn?.cause, "provider-error", "read_agent names the provider error.");
    return { model: setup.model, usageLimitReturn: setup.usageLimitReturn };
  });

  await check("a 429 rate limit and an insufficient quota error move a turn that wrote text", async () => {
    const moves: { kind: string; model: string }[] = [];
    for (const [agent, kind] of [
      [rate, "429"],
      [quota, "quota"],
    ] as const) {
      await restart([`${PRIMARY}|${kind}`]);
      const before = turns().length;
      const outcome = await send(agent.id, "act-then-fail");
      assert.equal(outcome.status, "completed", `The ${kind} turn completes: ${outcome.error}`);
      const ran = turns().slice(before);
      assert.deepEqual(
        ran.map((turn) => turn.model),
        [PRIMARY, BACKUP],
        `The ${kind} turn runs once on each model.`,
      );
      assert.ok(ran[1]?.prompt?.includes("Partial answer."), `The ${kind} backup turn keeps the partial answer.`);
      moves.push({ kind, model: agentOf(agent.id).model });
    }
    return moves;
  });

  await check("a plan window that stops a turn after it wrote text moves it to the backup with a handoff", async () => {
    await restart([`${PRIMARY}|limit`]);
    const since = events.length;
    const before = turns().length;
    const outcome = await send(plan.id, "act-then-fail");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message runs once on each model.",
    );
    assert.ok(ran[1]?.prompt?.includes("Partial answer."), "The backup turn keeps the partial answer.");
    assert.equal(agentOf(plan.id).model, BACKUP, "The agent is on the backup model.");
    assert.equal(agentOf(plan.id).usageLimitReturn?.model, PRIMARY, "The agent keeps its own model to go back to.");
    assert.deepEqual(errorsFor(plan.id, since), [], "No error shows for the moved turn.");
    const notes = await markers(plan.id, MODEL_SWITCH_ITEM_TYPES["usage-limit"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelSwitchedForLimit", { model: modelName(BACKUP) })]);
    return { ran: ran.map((turn) => turn.model), notes };
  });

  await check("a tool step that ran before a limit does not run again on the backup", async () => {
    await restart([PRIMARY]);
    const runsBefore = effectRuns();
    const before = turns().length;
    const outcome = await send(tools.id, "use-tool act-then-fail");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message runs once on each model.",
    );
    const retry = ran[1]?.prompt ?? "";
    assert.ok(retry.includes("[work steps]"), "The backup turn starts with the work steps of the first attempt.");
    assert.ok(retry.includes("tool Bash"), "The work steps name the tool that ran.");
    assert.equal(effectRuns() - runsBefore, 1, "The tool ran once, on the first attempt only.");
    assert.equal(agentOf(tools.id).model, BACKUP, "The agent is on the backup model.");
    return { ran: ran.map((turn) => turn.model), toolRuns: effectRuns() - runsBefore };
  });

  await check("when the backup fails too, the turn fails once and does not loop", async () => {
    await restart([PRIMARY, BACKUP]);
    const since = events.length;
    const before = turns().length;
    const outcome = await send(exhausted.id, "work");
    assert.equal(outcome.status, "failed", "The turn fails.");
    const ran = turns()
      .slice(before)
      .map((turn) => turn.model);
    assert.deepEqual(ran, [PRIMARY, BACKUP], "Each model runs the turn once.");
    assert.ok(errorsFor(exhausted.id, since).length > 0, "The error shows.");
    return { ran, error: outcome.error };
  });

  await check("after a restart the agent goes back to its own model", async () => {
    await restart([]);
    const before = turns().length;
    const outcome = await send(mover.id, "again");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    assert.deepEqual(
      turns()
        .slice(before)
        .map((turn) => turn.model),
      [PRIMARY],
      "The message runs on the own model.",
    );
    const agent = agentOf(mover.id);
    assert.equal(agent.model, PRIMARY, "The agent is back on its own model.");
    assert.equal(agent.usageLimitReturn, undefined, "Nothing is left to go back to.");
    const notes = await markers(mover.id, MODEL_SWITCH_ITEM_TYPES["provider-error-ended"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelReturnedAfterError", { model: modelName(PRIMARY) })]);
    return { notes };
  });

  // The card's text, derived from the held state the service reports, through the same choice the card makes.
  await check("the usage-limit card text follows the held state", async () => {
    await restart([`${PRIMARY}|limit`, `${BACKUP}|limit`]);
    // Both models hit a plan window: the exhausted agent moves to BACKUP and holds there, and the other
    // agent holds on its own model with no backup set.
    await runCauseEffect(service.sendMessage({ agentId: exhausted.id, text: "work" }));
    await waitFor("the exhausted agent to hold", () => {
      const held = service.getRuntimeSnapshot().usageLimits ?? [];
      return held.some((entry) => entry.agentId === exhausted.id) ? held : null;
    });
    await runCauseEffect(service.sendMessage({ agentId: stayer.id, text: "work" }));
    const snapshot = await waitFor("both agents to hold", () => {
      const current = service.getRuntimeSnapshot();
      const held = current.usageLimits ?? [];
      return held.some((entry) => entry.agentId === stayer.id) && held.some((entry) => entry.agentId === exhausted.id)
        ? current
        : null;
    });
    const limited = snapshot.usageLimitedModels ?? [];
    const card = (agentId: string) => {
      const agent = agentOf(agentId);
      const own = { provider: agent.provider, model: agent.model };
      const options = service
        .listModels()
        .filter((model) => !(model.provider === own.provider && model.id === own.model))
        .filter((model) => !limited.some((held) => held.provider === model.provider && held.model === model.id));
      const hold = (snapshot.usageLimits ?? []).find((entry) => entry.agentId === agentId);
      return {
        key: usageLimitAskBodyKey({
          optionCount: options.length,
          hasBackup: (agent.backupModels?.order.length ?? 0) > 0,
          hasReset: hold?.resetsAt !== null && hold?.resetsAt !== undefined,
        }),
      };
    };
    const exhaustedCard = card(exhausted.id);
    const stayerCard = card(stayer.id);
    assert.equal(exhaustedCard.key, "chat.usageLimit.exhausted", "Every backup is at its limit.");
    assert.equal(stayerCard.key, "chat.usageLimit.noBackup", "No backup is set and no other model is ready.");
    return { exhausted: exhaustedCard.key, stayer: stayerCard.key };
  });

  report.passed = report.checks.length === 12;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(service.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.checks) process.stdout.write(`PASS ${entry.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
