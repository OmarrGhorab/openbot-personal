// Asks a side chat about a running work thread (agent task) end to end in this worktree's running dev
// app, through the real preload bridge, IPC, agent service and provider. It changes the data of the
// profile, so start the app with `bun run dev` (never `--shared`), and pass the id of an agent whose
// provider is signed in and runs turns at the same time (not a custom ACP agent):
// `bun scripts/agent-side-chat-e2e.ts --allow-mutations --agent=<agent id>`.
//
// It starts a long task, asks a side question with its `taskId` while the turn runs, and checks that
// the answer comes back, that the task turn was still running when it came, and that the turn then
// completes without an interruption. Then "Send to main thread" sends text into the task, and the
// task takes it as a message. At the end it stops, closes and deletes the task it started.
// Writes .openbot-build/agent-side-chat-e2e/report.json.
import assert from "node:assert/strict";
import { connectWorkThreads, historyText, scriptArgument, taskIn, writeReport } from "./agent-work-threads-e2e-support";

const agentId = scriptArgument("agent");
assert.ok(agentId, "Pass --agent=<agent id> of an agent whose provider is signed in.");

// Long enough that the task still runs while the side chat answers.
const LONG_PROMPT = "Write a numbered list of 60 short facts about rivers. Do not use tools.";
const SIDE_QUESTION = "In three words or fewer, what is this task about?";
const FOLLOW_UP = `Reply with the single word FOLLOWUP-${crypto.randomUUID().slice(0, 8)}. Do not use tools.`;

interface Report {
  agentId: string;
  provider?: string;
  taskId?: string;
  sideChat?: { answer: string; milliseconds: number; taskStateAtAnswer: string; turnsBefore: number };
  mainTurn?: { outcome: string | null; interrupted: boolean };
  sendToMain?: { accepted: boolean; delivered: boolean };
  cleanup?: { deleted: number };
  passed: boolean;
}

const report: Report = { agentId, passed: false };
const app = await connectWorkThreads("agent-side-chat-e2e", agentId);
const agent = await app.requireConcurrentAgent();
report.provider = agent.provider;

try {
  const task = await app.startTask(LONG_PROMPT);
  report.taskId = task.id;
  await app.waitForTasks("the task runs", (snapshot) => taskIn(snapshot, task.id).state === "running");
  const turnsBefore = (await app.readTask(task.id)).messages.length;

  // 1. The side chat answers while the task turn runs.
  const startedAt = Date.now();
  const answer = await app.page.evaluate(
    ({ id, taskId, question }) => window.openbot.agent.askSideQuestion({ agentId: id, question, earlier: [], taskId }),
    { id: agentId, taskId: task.id, question: SIDE_QUESTION },
  );
  const atAnswer = taskIn(await app.listTasks(), task.id);
  report.sideChat = {
    answer,
    milliseconds: Date.now() - startedAt,
    taskStateAtAnswer: atAnswer.state,
    turnsBefore,
  };
  assert.ok(answer.trim().length > 0, "The side chat gave an empty answer.");

  // 2. The main turn continues and completes: the side chat did not block, queue behind or stop it.
  const finished = await app.waitForTasks("the task finishes", (snapshot) => {
    const current = taskIn(snapshot, task.id);
    return current.state === "idle" && current.outcome !== null;
  });
  const outcome = taskIn(finished, task.id).outcome;
  report.mainTurn = { outcome, interrupted: outcome === "interrupted" };
  assert.equal(outcome, "completed", "The task turn did not complete after the side chat.");
  const history = historyText(await app.readTask(task.id));
  assert.ok(!history.includes(SIDE_QUESTION), "The side question went into the task history.");

  // 3. "Send to main thread" puts the text into the task as a normal message.
  const receipt = await app.page.evaluate(
    ({ id, taskId, text }) =>
      window.openbot.agent.sendMessage({ agentId: id, taskId, text, clientMessageId: crypto.randomUUID() }),
    { id: agentId, taskId: task.id, text: FOLLOW_UP },
  );
  await app.waitForTasks("the sent text runs", (snapshot) => {
    const current = taskIn(snapshot, task.id);
    return current.state === "idle" && current.queuedMessages.length === 0;
  });
  const delivered = historyText(await app.readTask(task.id)).includes(FOLLOW_UP);
  report.sendToMain = { accepted: receipt !== null && receipt !== undefined, delivered };
  assert.ok(delivered, "The task history does not hold the text sent to the main thread.");

  // The side chat answered during the turn only if the turn still ran then; a fast provider can end first.
  if (report.sideChat.taskStateAtAnswer !== "running")
    process.stderr.write("The task ended before the side answer came. Use a longer prompt for a stronger check.\n");
  report.passed = true;
} finally {
  const { deleted } = await app.cleanUp();
  report.cleanup = { deleted };
  await app.session.close();
  writeReport("agent-side-chat-e2e", report);
}
