// Checks the question queue of work threads: a question blocks its thread, the Questions list shows every
// open question, a blocked thread frees its turn slot for another task, and an answer resumes the thread
// that asked. The real agent service, task store, drain, attention registry and notification rules run on
// a temporary profile. A scripted Codex app-server (`provider-fakes/codex-questions.ts`) stands in for the
// provider: its turn calls `ask_user` and waits for the answer. No model runs.
// The agent has the default task limit of 2. Two tasks ask questions and wait; a third task must still run
// to its end, because a waiting task holds no slot. Then each answer must reach the task that asked.
// `bun scripts/question-queue-e2e.ts`. Writes .openbot-build/question-queue-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  type AgentTask,
  type OpenQuestion,
  type RespondToPromptInput,
} from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { notificationForAgentEvent } from "@openbot/team-client/agent-notifications";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { runCauseEffect } from "../src/backend/effect-boundary";

const OUT = resolve(import.meta.dirname, "../.openbot-build/question-queue-e2e");
const FAKE_SOURCE = resolve(import.meta.dirname, "provider-fakes/codex-questions.ts");
const root = await mkdtemp(join(tmpdir(), "openbot-question-queue-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const CALL_MARK = "QUESTION-CALL";
const TASK_A_TITLE = "Task A: choose the header colour";
const TASK_B_TITLE = "Task B: choose the footer text";
const TASK_C_TITLE = "Task C: write a short note";
const CHAT_QUESTION = "Which folder should the note go in?";
const ANSWER_A = "Blue header";
const ANSWER_B = "Footer text one";
const ANSWER_CHAT = "Notes folder";

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.FAKE_CODEX_LOG = fakeLog;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface Check {
  name: string;
  passed: boolean;
}

const report: {
  model: string;
  passed: boolean;
  checks: Check[];
  questions: { taskTitle: string | null; questionText: string; agentName: string }[];
  notification: { title: string; body: string } | null;
  unverified: string[];
  error?: string;
} = {
  model: "none. A scripted Codex app-server stands in for the provider; no model runs.",
  passed: false,
  checks: [],
  questions: [],
  notification: null,
  unverified: [
    "The desktop window: the Questions section and the task labels are not rendered or clicked here.",
    "The OS notification and the mobile push: only the shared notification text is checked.",
    "A real provider that decides to ask a question. The fake calls the tool on purpose.",
    "The joined-server path: a remote host's questions are not in this list by design.",
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
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function pass(name: string, condition: boolean, detail?: string): void {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

interface FakeLogEntry {
  kind?: string;
  turnId?: string;
  result?: { success: boolean; contentItems: { type: string; text: string }[] } | null;
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

/** The task of the list with this title. */
function taskTitled(agents: InstanceType<typeof AgentService>, agentId: string, title: string): AgentTask | undefined {
  return agents.listTasks(agentId).tasks.find((task) => task.title === title);
}

/** The text that makes the fake call `ask_user` with one question. */
function questionBrief(title: string, question: string): string {
  const args = { __tool: "ask_user", questions: [{ id: "answer", header: "Question", question }] };
  return `${title}\n${CALL_MARK} <<ARGS${JSON.stringify(args)}ARGS>>`;
}

// The fake is a Bun script; a shell wrapper gives it the name the provider client starts.
await writeFile(fakeCodex, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_SOURCE}" "$@"\n`, { mode: 0o755 });
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
const events: AgentEvent[] = [];
agents.on("event", (event) => events.push(event));

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Questions",
      description: "Asks when it is blocked.",
      avatarSeed: "questions",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor("the first chat turn to end", () => idle(agent.id));

  // Tasks A and B ask a question each, so both wait and hold no slot.
  const taskA = await runCauseEffect(
    agents.startTask({ agentId: agent.id, text: questionBrief(TASK_A_TITLE, "Which colour for the header?") }),
  );
  const taskB = await runCauseEffect(
    agents.startTask({ agentId: agent.id, text: questionBrief(TASK_B_TITLE, "Which text for the footer?") }),
  );

  const questionOfA = await waitFor("the question of task A", () =>
    agents.listOpenQuestions().questions.find((question) => question.taskId === taskA.id),
  );
  const questionOfB = await waitFor("the question of task B", () =>
    agents.listOpenQuestions().questions.find((question) => question.taskId === taskB.id),
  );
  pass("task A asks a question", questionOfA.questions[0]?.question === "Which colour for the header?");
  pass("task B asks a question", questionOfB.questions[0]?.question === "Which text for the footer?");

  // Blocked state on the work thread: its task row shows the question text, and the turn is still open.
  const blockedA = taskTitled(agents, agent.id, TASK_A_TITLE);
  pass(
    "task A is blocked with its question text",
    blockedA?.question?.text === "Which colour for the header?" && blockedA.activeTurnId !== null,
    JSON.stringify(blockedA?.question),
  );

  // A third task runs to its end while A and B wait. Without the freed slot it would wait with the
  // task-limit hold, and this wait would time out.
  const taskC = await runCauseEffect(
    agents.startTask({ agentId: agent.id, text: `${TASK_C_TITLE}\nSay that the note is ready.` }),
  );
  const doneC = await waitFor("task C to finish while A and B wait", () => {
    const task = taskOfId(agents, agent.id, taskC.id);
    return task?.outcome === "completed" && task.activeTurnId === null ? task : null;
  });
  pass("task C runs while A and B wait", doneC.outcome === "completed");
  pass(
    "waiting tasks still hold their questions after C ends",
    agents.listOpenQuestions().questions.filter((question) => question.taskId !== null).length === 2,
  );

  // A question of the agent's own chat appears in the same list, with no task.
  const chatBrief = `${CALL_MARK} <<ARGS${JSON.stringify({
    __tool: "ask_user",
    questions: [{ id: "folder", header: "Folder", question: CHAT_QUESTION }],
  })}ARGS>>`;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: chatBrief }));
  const chatQuestion = await waitFor("the question of the agent's own chat", () =>
    agents.listOpenQuestions().questions.find((question) => question.taskId === null),
  );
  pass("the agent's own chat question has no task", chatQuestion.taskTitle === null);
  pass("the agent's own chat question names the agent", chatQuestion.agentName === "Questions");

  const listed = agents.listOpenQuestions().questions;
  report.questions = listed.map((question: OpenQuestion) => ({
    taskTitle: question.taskTitle,
    questionText: question.questions[0]?.question ?? "",
    agentName: question.agentName,
  }));
  pass("all three open questions are in one list", listed.length === 3, `${listed.length} questions`);

  // The notification text of a task question names the task and carries the question, as the desktop
  // and the phone show it.
  const promptEvent = events.find(
    (event): event is Extract<AgentEvent, { type: "prompt" }> =>
      event.type === "prompt" && event.threadId === taskA.threadId,
  );
  pass("the service emits a prompt event on the task thread", promptEvent !== undefined);
  if (promptEvent) {
    const content = notificationForAgentEvent(
      promptEvent,
      agents.listAgents(),
      translateFor("en"),
      "all",
      { reply: null, redact: (text) => text },
      null,
      { title: taskA.title },
    );
    report.notification = content ? { title: content.title, body: content.body } : null;
    pass(
      "the question notification names the task",
      content?.title === `Questions, task: ${TASK_A_TITLE}`,
      JSON.stringify(content),
    );
    pass(
      "the question notification carries the question",
      content?.body === "Which colour for the header?",
      JSON.stringify(content),
    );
  }

  // An answer resumes the task that asked: A ends with its own answer, B still waits.
  await runCauseEffect(agents.respondToPrompt(answerInput(questionOfA, ANSWER_A)));
  const endedA = await waitFor("task A to end after its answer", () => {
    const task = taskOfId(agents, agent.id, taskA.id);
    return task?.outcome === "completed" && task.activeTurnId === null ? task : null;
  });
  pass("task A ends after the answer", endedA.question === null);
  const turnAEntry = fakeEntries().find((entry) => entry.turnId === questionOfA.turnId);
  const resultA = turnAEntry?.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  pass("the answer reaches the turn of task A", resultA.includes(ANSWER_A), resultA.slice(0, 200));
  const stillB = taskOfId(agents, agent.id, taskB.id);
  pass("task B still waits for its own answer", stillB?.question?.text === "Which text for the footer?");
  pass(
    "task B's answer is still open in the list",
    agents.listOpenQuestions().questions.some((question) => question.requestId === questionOfB.requestId),
  );

  await runCauseEffect(agents.respondToPrompt(answerInput(questionOfB, ANSWER_B)));
  await waitFor("task B to end after its answer", () => {
    const task = taskOfId(agents, agent.id, taskB.id);
    return task?.outcome === "completed" && task.activeTurnId === null ? task : null;
  });
  const turnBEntry = fakeEntries().find((entry) => entry.turnId === questionOfB.turnId);
  const resultB = turnBEntry?.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  pass("the answer reaches the turn of task B", resultB.includes(ANSWER_B), resultB.slice(0, 200));

  await runCauseEffect(agents.respondToPrompt(answerInput(chatQuestion, ANSWER_CHAT)));
  await waitFor("the agent's own chat to end after its answer", () => idle(agent.id));
  pass(
    "the Questions list is empty once every question is answered",
    agents.listOpenQuestions().questions.length === 0,
    JSON.stringify(agents.listOpenQuestions()),
  );
  const endedAll = agents.listTasks(agent.id).tasks.filter((task) => task.question !== null);
  pass("no task keeps a question after its answer", endedAll.length === 0);

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

function taskOfId(service: InstanceType<typeof AgentService>, agentId: string, taskId: string): AgentTask | undefined {
  return service.listTasks(agentId).tasks.find((task) => task.id === taskId);
}

/** The answer to a question: the text under the id of its one question, as the card sends it. */
function answerInput(question: OpenQuestion, text: string): RespondToPromptInput {
  const id = question.questions[0]?.id ?? "";
  return { requestId: question.requestId, answers: { [id]: [text] } };
}
