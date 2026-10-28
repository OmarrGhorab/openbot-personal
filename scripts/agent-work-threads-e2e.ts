// Runs two work threads (agent tasks) of one agent end to end in this worktree's running dev app,
// through the real preload bridge, IPC, agent service and provider. It changes the data of the
// profile, so start the app with `bun run dev` (never `--shared`), and pass the id of an agent whose
// provider is signed in and runs turns at the same time (not a custom ACP agent):
// `bun scripts/agent-work-threads-e2e.ts --allow-mutations --agent=<agent id>`.
//
// It starts two tasks in two threads at the same time, waits until both finish, and checks that the
// history of each task holds only its own messages, that each task has its own thread, and that two
// worktree tasks have two folders and two branches. At the end it stops, closes and deletes the
// tasks it started and gives the agent its task limit back.
// Writes .openbot-build/agent-work-threads-e2e/report.json.
import assert from "node:assert/strict";
import { connectWorkThreads, historyText, scriptArgument, taskIn, writeReport } from "./agent-work-threads-e2e-support";

const agentId = scriptArgument("agent");
assert.ok(agentId, "Pass --agent=<agent id> of an agent whose provider is signed in.");

// A marker that only one task can know, so a leak from one history to the other shows.
const markers = [`ALPHA-${crypto.randomUUID().slice(0, 8)}`, `BRAVO-${crypto.randomUUID().slice(0, 8)}`] as const;
const prompt = (marker: string) => `Reply with the single word ${marker}. Do not use tools.`;

interface ThreadReport {
  taskId: string;
  threadId: string;
  outcome: string | null;
  workspace: string;
  ownMarker: boolean;
  otherMarker: boolean;
}

interface Report {
  agentId: string;
  provider?: string;
  threads: ThreadReport[];
  ranTogether?: boolean;
  separateThreads?: boolean;
  separateWorktrees?: boolean | null;
  cleanup?: { deleted: number; taskLimit: number | null };
  passed: boolean;
}

const report: Report = { agentId, threads: [], passed: false };
const app = await connectWorkThreads("agent-work-threads-e2e", agentId);
const agent = await app.requireConcurrentAgent();
report.provider = agent.provider;
const originalLimit = agent.taskLimit ?? null;

try {
  await app.setTaskLimit(2);
  const first = await app.startTask(prompt(markers[0]));
  const second = await app.startTask(prompt(markers[1]));

  // With a limit of two, neither task waits for the other.
  const both = await app.waitForTasks("both tasks start", (snapshot) =>
    [first.id, second.id].every((taskId) => taskIn(snapshot, taskId).state !== "queued"),
  );
  report.ranTogether = [first.id, second.id].every((taskId) => taskIn(both, taskId).hold !== "task-limit");

  const finished = await app.waitForTasks("both tasks finish", (snapshot) =>
    [first.id, second.id].every((taskId) => {
      const task = taskIn(snapshot, taskId);
      return task.state === "idle" && task.outcome !== null;
    }),
  );

  for (const [index, taskId] of [first.id, second.id].entries()) {
    const task = taskIn(finished, taskId);
    const history = historyText(await app.readTask(taskId));
    const workspace = task.workspace;
    report.threads.push({
      taskId,
      threadId: task.threadId,
      outcome: task.outcome,
      workspace: workspace?.mode === "worktree" ? `worktree:${workspace.branch}` : (workspace?.mode ?? "unknown"),
      ownMarker: history.includes(markers[index] ?? ""),
      otherMarker: history.includes(markers[1 - index] ?? ""),
    });
  }
  const [a, b] = report.threads;
  assert.ok(a && b);
  report.separateThreads = a.threadId !== b.threadId;
  const workspaces = [first.id, second.id].map((taskId) => taskIn(finished, taskId).workspace);
  report.separateWorktrees = workspaces.every((workspace) => workspace?.mode === "worktree")
    ? new Set(workspaces.map((workspace) => (workspace?.mode === "worktree" ? workspace.path : ""))).size === 2
    : null;

  assert.ok(report.ranTogether, "A task waited for the task limit.");
  assert.ok(report.separateThreads, "The two tasks share a thread.");
  for (const thread of report.threads) {
    assert.equal(thread.outcome, "completed", `Task ${thread.taskId} did not complete.`);
    assert.ok(thread.ownMarker, `The history of task ${thread.taskId} does not hold its own message.`);
    assert.ok(!thread.otherMarker, `The history of task ${thread.taskId} holds a message of the other task.`);
  }
  assert.notEqual(report.separateWorktrees, false, "Two worktree tasks share a folder.");
  report.passed = true;
} finally {
  const { deleted } = await app.cleanUp();
  const restored = await app.setTaskLimit(originalLimit);
  report.cleanup = { deleted, taskLimit: restored.taskLimit ?? null };
  await app.session.close();
  writeReport("agent-work-threads-e2e", report);
}
