// Checks that a channel request goes to the members that its text addresses (issue #33).
// Part 1 runs the matcher on fixed cases. Part 2 runs the real agent service and channel service on a
// temporary profile with a fake Codex app-server, in a channel with Worker Engineer (lead) and
// Software Engineer. It sends "hey guys", one name, two names, a mention with another name, an unclear
// message, two real routing failures (fixed by Continue and by Reassign) and a name that two members
// share. The fake answers each routing turn of the lead from a marker in the request, and logs each
// routing turn, so the check can see when no routing turn ran.
// `bun scripts/channel-name-routing-e2e.ts`. Writes .openbot-build/channel-name-routing-e2e/report.json.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ChannelAddress, channelAddress } from "@openbot/contracts/channel-addressing";
import { AGENT_PROVIDERS, type ChannelCommand, type ChannelTask } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-name-routing-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-name-routing-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

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

const PERSON = { id: "local", name: "Alex" };
const QUESTION = "Who should fix the deploy: Worker Engineer or Software Engineer?";

/**
 * A Codex app-server with the methods that the service calls. A routing turn of the lead (its prompt
 * starts with "Select one responsible channel member") is answered from a marker in the task:
 * ROUTE-ASK returns a question, ROUTE-BAD returns prose (a real failure), ROUTE-FLAKY fails once and
 * then picks the first agent, and any other task picks the first agent. Each routing turn is logged.
 * Member turns answer "Done." and are logged too.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const QUESTION = ${JSON.stringify(QUESTION)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const flaky = new Map();
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
const route = (text) => {
  let data = {};
  try { data = JSON.parse(text.split("\\n")[1] || "{}"); } catch {}
  const instruction = (data.task && data.task.instruction) || "";
  const first = (data.agents && data.agents[0] && data.agents[0].id) || "unknown";
  log({ kind: "route", instruction });
  if (instruction.includes("ROUTE-ASK")) return JSON.stringify({ question: QUESTION });
  if (instruction.includes("ROUTE-BAD")) return "I cannot decide who should do this.";
  if (instruction.includes("ROUTE-FLAKY")) {
    const count = (flaky.get(instruction) || 0) + 1;
    flaky.set(instruction, count);
    if (count === 1) return "I cannot decide who should do this.";
  }
  return JSON.stringify({ agentId: first });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      if (text.startsWith("Select one responsible channel member")) {
        const reply = route(text);
        return setTimeout(() => finish(params.threadId, turnId, reply), 10);
      }
      log({ kind: "member", threadId: params.threadId });
      return setTimeout(() => finish(params.threadId, turnId, "Done."), 20);
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
  detail?: string;
}

const report: {
  matcher: (Check & { text: string; result: ChannelAddress })[];
  service: (Check & { messages?: { author: string; text: string }[]; tasks?: Partial<ChannelTask>[] })[];
  matcherPassed: number;
  servicePassed: number;
  passed: boolean;
  error?: string;
} = { matcher: [], service: [], matcherPassed: 0, servicePassed: 0, passed: false };

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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function routingTurns(): number {
  try {
    return readFileSync(fakeLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .filter((line) => JSON.parse(line).kind === "route").length;
  } catch {
    return 0;
  }
}

// Part 1: the matcher.
const WE = { agentId: "we", name: "Worker Engineer" };
const SE = { agentId: "se", name: "Software Engineer" };
const TWO = [WE, SE];
const matcherCases: { text: string; members: { agentId: string; name: string }[]; expected: ChannelAddress }[] = [
  { text: "hey guys", members: TWO, expected: { kind: "everyone", agentIds: ["we", "se"] } },
  { text: "Software Engineer, check this", members: TWO, expected: { kind: "named", agentIds: ["se"] } },
  { text: "worker engineer can you help", members: TWO, expected: { kind: "named", agentIds: ["we"] } },
  {
    text: "Worker Engineer and Software Engineer, review the PR",
    members: TWO,
    expected: { kind: "named", agentIds: ["we", "se"] },
  },
  { text: "everyone, what is the status?", members: TWO, expected: { kind: "everyone", agentIds: ["we", "se"] } },
  { text: "team, ship it today", members: TWO, expected: { kind: "everyone", agentIds: ["we", "se"] } },
  { text: "hi all", members: TWO, expected: { kind: "everyone", agentIds: ["we", "se"] } },
  { text: "hello", members: TWO, expected: { kind: "everyone", agentIds: ["we", "se"] } },
  { text: "يا شباب", members: TWO, expected: { kind: "everyone", agentIds: ["we", "se"] } },
  { text: "fix all the tests", members: TWO, expected: { kind: "unaddressed" } },
  {
    text: "hey guys, Software Engineer can you check the build",
    members: TWO,
    expected: { kind: "named", agentIds: ["se"] },
  },
  {
    text: "Software Engineer 2 take this one",
    members: [...TWO, { agentId: "se2", name: "Software Engineer 2" }],
    expected: { kind: "named", agentIds: ["se2"] },
  },
  { text: "@[Software Engineer](agent:se) look at this", members: TWO, expected: { kind: "unaddressed" } },
  { text: "> Software Engineer said this\nwhat now?", members: TWO, expected: { kind: "unaddressed" } },
  {
    text: "Software Engineer, check the logs",
    members: [WE, SE, { agentId: "se-b", name: "software engineer" }],
    expected: { kind: "ambiguous", name: "Software Engineer", agentIds: ["se", "se-b"] },
  },
  {
    text: "hey everyone",
    members: ["a", "b", "c", "d", "e"].map((id) => ({ agentId: id, name: `Agent ${id.toUpperCase()}` })),
    expected: { kind: "everyone", agentIds: ["a", "b", "c"] },
  },
  { text: 'rename the "Software Engineer" label', members: TWO, expected: { kind: "unaddressed" } },
];
for (const item of matcherCases) {
  const result = channelAddress(item.text, item.members);
  const passed = JSON.stringify(result) === JSON.stringify(item.expected);
  report.matcher.push({
    name: `${item.expected.kind}: ${item.text}`,
    text: item.text,
    result,
    passed,
    ...(passed ? {} : { detail: `expected ${JSON.stringify(item.expected)}` }),
  });
}

// Part 2: the services.
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
  timezone: () => "UTC",
});
const channels = () => agents.channels;

function settled(channelId: string) {
  return waitFor("the channel tasks to end", () =>
    channels()
      .store.tasks(channelId)
      .every((task) => !["queued", "running", "waiting"].includes(task.state)),
  );
}

function command(input: ChannelCommand) {
  return runCauseEffect(channels().command(input, PERSON));
}

/** Sends a request and returns its tasks and the messages of those tasks after the channel settles. */
async function send(channelId: string, text: string, recipientAgentId: string | null = null) {
  const before = new Set(
    channels()
      .store.messages(channelId)
      .map((entry) => entry.id),
  );
  const routesBefore = routingTurns();
  await command({
    type: "send",
    operationId: randomUUID(),
    channelId,
    text,
    recipientAgentId,
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  await settled(channelId);
  return observe(channelId, before, routesBefore);
}

function observe(channelId: string, before: Set<string>, routesBefore: number) {
  const all = channels().store.messages(channelId);
  const request = all.find((entry) => !before.has(entry.id) && entry.author.kind === "member");
  const tasks = channels()
    .store.tasks(channelId)
    .filter((task) => request && task.requestMessageId === request.id);
  const messages = all.filter((entry) => !before.has(entry.id) && entry.id !== request?.id);
  return { request, tasks, messages, routes: routingTurns() - routesBefore };
}

type Observed = ReturnType<typeof observe>;

function check(name: string, observed: Observed | null, passed: boolean, detail?: string) {
  report.service.push({
    name,
    passed,
    ...(detail ? { detail } : {}),
    ...(observed
      ? {
          messages: observed.messages.map((entry) => ({
            author: `${entry.author.kind}:${entry.author.name}`,
            text: entry.message.text.slice(0, 160),
          })),
          tasks: observed.tasks.map(({ ownerAgentId, state, error }) => ({ ownerAgentId, state, error })),
        }
      : {}),
  });
}

const coordinatorSpoke = (observed: Observed) => observed.messages.some((entry) => entry.author.kind === "coordinator");
const answeredBy = (observed: Observed, agentId: string) =>
  observed.messages.some(
    (entry) => entry.author.kind === "agent" && entry.author.id === agentId && entry.message.author === "assistant",
  );

try {
  await runCauseEffect(agents.initialize());
  const create = async (name: string) => {
    const agent = await runCauseEffect(
      agents.createAgent({
        name,
        description: `${name} works in the Playerhub channel.`,
        avatarSeed: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${randomUUID().slice(0, 8)}`,
        avatarHue: null,
        initialMessage: "Hello.",
      }),
    );
    await waitFor(`the first chat turn of ${name} to end`, () =>
      agents
        .listQueue(agent.id)
        .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
    );
    return agent;
  };
  const worker = await create("Worker Engineer");
  const software = await create("Software Engineer");
  const threadsBefore = [worker, software].map((agent) => [agent.id, store.ensureThreadIdNow(agent.id)] as const);
  const channelId = randomUUID();
  await command({
    type: "save",
    operationId: randomUUID(),
    channelId,
    draft: {
      name: "Playerhub",
      title: "",
      instructions: "Build Playerhub.",
      members: [{ agentId: software.id }, { agentId: worker.id }],
      leadAgentId: worker.id,
    },
  });

  // 1. "hey guys": both members answer, the lead first, with no routing turn and no error.
  const guys = await send(channelId, "hey guys");
  check(
    '"hey guys": every member answers, no error, no pause',
    guys,
    guys.tasks.length === 2 &&
      guys.tasks.every((task) => task.state === "completed") &&
      answeredBy(guys, worker.id) &&
      answeredBy(guys, software.id) &&
      !coordinatorSpoke(guys),
  );
  check(
    '"hey guys": the lead answers first and no routing turn runs',
    guys,
    guys.tasks[0]?.ownerAgentId === worker.id && guys.routes === 0,
  );

  // 2. One name: only that member answers, with no mention and no routing turn.
  const one = await send(channelId, "Software Engineer, check the login form");
  check(
    "One name: only that member answers, no routing turn",
    one,
    one.tasks.length === 1 &&
      one.tasks[0]?.ownerAgentId === software.id &&
      one.tasks[0]?.state === "completed" &&
      answeredBy(one, software.id) &&
      !answeredBy(one, worker.id) &&
      one.routes === 0,
  );

  // 3. Two names: both answer.
  const two = await send(channelId, "Worker Engineer and Software Engineer, review the API change");
  check(
    "Two names: both members answer",
    two,
    two.tasks.length === 2 &&
      two.tasks.every((task) => task.state === "completed") &&
      answeredBy(two, worker.id) &&
      answeredBy(two, software.id) &&
      two.routes === 0,
  );

  // 4. An explicit mention at the start wins over another name in the text.
  const mention = await send(
    channelId,
    `@[Software Engineer](agent:${software.id}) ask Worker Engineer about the schema`,
    software.id,
  );
  check(
    "Explicit mention wins over another name",
    mention,
    mention.tasks.length === 1 && mention.tasks[0]?.ownerAgentId === software.id && !answeredBy(mention, worker.id),
  );

  // 5. An unclear message: the lead asks one short question as a normal message. Not paused.
  const unclear = await send(channelId, "ROUTE-ASK fix the flaky deploy");
  check(
    "Unclear message: the lead asks a question as a normal message",
    unclear,
    unclear.routes === 1 &&
      unclear.messages.some(
        (entry) =>
          entry.author.kind === "agent" &&
          entry.author.id === worker.id &&
          entry.message.author === "assistant" &&
          entry.message.text === QUESTION,
      ),
  );
  check(
    "Unclear message: the request completes, no pause, no Coordinator error",
    unclear,
    unclear.tasks.length === 1 && unclear.tasks[0]?.state === "completed" && !coordinatorSpoke(unclear),
  );

  // 6. A real failure pauses with a Coordinator notice; Reassign fixes it.
  const bad = await send(channelId, "ROUTE-BAD refactor the build scripts");
  const badTask = bad.tasks[0];
  check(
    "Real failure: the task pauses with a Coordinator notice",
    bad,
    bad.tasks.length === 1 && badTask?.state === "paused" && coordinatorSpoke(bad),
  );
  if (badTask) {
    const before = new Set(
      channels()
        .store.messages(channelId)
        .map((entry) => entry.id),
    );
    await command({
      type: "reassign",
      operationId: randomUUID(),
      channelId,
      taskId: badTask.id,
      recipientAgentId: software.id,
    });
    await settled(channelId);
    const after = channels()
      .store.tasks(channelId)
      .find((task) => task.id === badTask.id);
    const observed = { ...bad, tasks: after ? [after] : [], messages: [] };
    check(
      "Real failure: Reassign gives the task to the chosen member and it completes",
      observed,
      after?.ownerAgentId === software.id &&
        after.state === "completed" &&
        channels()
          .store.messages(channelId)
          .some((entry) => !before.has(entry.id) && entry.author.kind === "agent" && entry.author.id === software.id),
    );
  }

  // 7. A real failure that Continue fixes: the lead fails once, then routes on the retry.
  const flaky = await send(channelId, "ROUTE-FLAKY update the release checklist");
  const flakyTask = flaky.tasks[0];
  check(
    "Real failure: the second task pauses with a Coordinator notice",
    flaky,
    flakyTask?.state === "paused" && coordinatorSpoke(flaky),
  );
  if (flakyTask) {
    await command({
      type: "resume",
      operationId: randomUUID(),
      channelId,
      taskId: flakyTask.id,
      recipientAgentId: null,
    });
    await settled(channelId);
    const after = channels()
      .store.tasks(channelId)
      .find((task) => task.id === flakyTask.id);
    check(
      "Real failure: Continue routes again and the task completes",
      { ...flaky, tasks: after ? [after] : [], messages: [] },
      after?.state === "completed" && after.ownerAgentId !== null,
    );
  }

  // 8. A name that two members share: the lead asks which one. No task runs, no pause.
  const twin = await create("Software Engineer");
  const sharedId = randomUUID();
  await command({
    type: "save",
    operationId: randomUUID(),
    channelId: sharedId,
    draft: {
      name: "shared",
      title: "",
      instructions: "",
      members: [{ agentId: worker.id }, { agentId: software.id }, { agentId: twin.id }],
      leadAgentId: worker.id,
    },
  });
  const shared = await send(sharedId, "Software Engineer, check the logs");
  check(
    "Shared name: the lead asks which member, as a normal message",
    shared,
    shared.tasks.length === 1 &&
      shared.tasks[0]?.state === "completed" &&
      shared.routes === 0 &&
      !coordinatorSpoke(shared) &&
      shared.messages.some(
        (entry) =>
          entry.author.kind === "agent" &&
          entry.author.id === worker.id &&
          entry.message.text.includes("More than one member is named Software Engineer"),
      ) &&
      !answeredBy(shared, software.id) &&
      !answeredBy(shared, twin.id),
  );

  // 9. No agent was reset: each keeps its thread.
  check(
    "No agent was reset: each keeps its thread",
    null,
    threadsBefore.every(([id, threadId]) => store.ensureThreadIdNow(id) === threadId),
  );
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  report.matcherPassed = report.matcher.filter((item) => item.passed).length;
  report.servicePassed = report.service.filter((item) => item.passed).length;
  report.passed =
    !report.error &&
    report.matcherPassed === report.matcher.length &&
    report.service.length === 13 &&
    report.servicePassed === report.service.length;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const item of report.matcher) process.stdout.write(`${item.passed ? "ok  " : "FAIL"} matcher  ${item.name}\n`);
  for (const item of report.service) process.stdout.write(`${item.passed ? "ok  " : "FAIL"} service  ${item.name}\n`);
  process.stdout.write(
    `matcher ${report.matcherPassed}/${report.matcher.length}, service ${report.servicePassed}/${report.service.length}\n`,
  );
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
