// Shared steps of the work-thread E2E scripts (`agent-work-threads-e2e.ts`, `agent-side-chat-e2e.ts`).
// Both drive this worktree's running dev app through the real preload bridge, IPC, agent service and
// provider, as `agent-tasks-e2e.ts` does.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import {
  type AgentSummary,
  type AgentTask,
  type AgentTasksSnapshot,
  type ClientAgentSummary,
  type ConversationSnapshot,
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

export const WAIT_MS = 180_000;

export function scriptArgument(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
}

/**
 * Connects to the one dev app of this worktree and gives the task calls of one agent. `command` names
 * the script for the mutation guard and the log.
 */
export async function connectWorkThreads(command: string, agentId: string) {
  const instances = readDevInstanceRecords().filter(
    (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
  );
  assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
  const instance = instances[0];
  assert.ok(instance);
  assertMutationAllowed({
    command,
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: true,
    target: instance.instanceId,
  });
  const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger(command), {
    expectedRendererPort: instance.rendererPort,
    ownerPid: instance.pid,
  });
  const page = session.page;
  const started: string[] = [];

  const listTasks = (): Promise<AgentTasksSnapshot> =>
    page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);

  const readTask = (taskId: string): Promise<ConversationSnapshot> =>
    page.evaluate(({ id, task }) => window.openbot.agent.readTask({ agentId: id, taskId: task }), {
      id: agentId,
      task: taskId,
    });

  async function readAgent(): Promise<AgentSummary> {
    const agent = await page.evaluate(async (id) => {
      const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Unknown agent: ${id}`);
      return found;
    }, agentId);
    if (!isAgentSummary(agent)) throw new Error(`The agent ${agentId} has a provider that this build does not know.`);
    return agent;
  }

  /** Checks that the provider runs turns at the same time, as two work threads need. */
  async function requireConcurrentAgent(): Promise<AgentSummary> {
    const agent = await readAgent();
    assert.ok(
      agentProviderDescriptor(agent.provider).concurrentTurns,
      `${agent.provider} runs one turn at a time. Choose an agent on another provider.`,
    );
    return agent;
  }

  const setTaskLimit = (taskLimit: number | null): Promise<ClientAgentSummary> =>
    page.evaluate(({ id, limit }) => window.openbot.agent.updateAgent({ agentId: id, taskLimit: limit }), {
      id: agentId,
      limit: taskLimit,
    });

  async function startTask(text: string): Promise<AgentTask> {
    const task = await page.evaluate(
      ({ id, prompt }) =>
        window.openbot.agent.startTask({ agentId: id, text: prompt, clientMessageId: crypto.randomUUID() }),
      { id: agentId, prompt: text },
    );
    started.push(task.id);
    return task;
  }

  /** Reads the task list until `ready` accepts it. The app pushes no event to this script, so it reads again. */
  async function waitForTasks(
    label: string,
    ready: (snapshot: AgentTasksSnapshot) => boolean,
  ): Promise<AgentTasksSnapshot> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const snapshot = await listTasks();
      if (ready(snapshot)) return snapshot;
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}. Tasks: ${JSON.stringify(snapshot.tasks)}`);
      await page.waitForTimeout(250);
    }
  }

  /** Stops, closes and deletes the tasks this script started, then closes the session. */
  async function cleanUp(): Promise<{ deleted: number }> {
    const call = (method: "stopTask" | "closeTask" | "deleteTask", taskId: string) =>
      page
        .evaluate(
          ({ id, task, name }) =>
            name === "stopTask"
              ? window.openbot.agent.stopTask({ agentId: id, taskId: task })
              : name === "closeTask"
                ? window.openbot.agent.closeTask({ agentId: id, taskId: task })
                : window.openbot.agent.deleteTask({ agentId: id, taskId: task }),
          { id: agentId, task: taskId, name: method },
        )
        .then(
          () => true,
          () => false,
        );
    for (const taskId of started) await call("stopTask", taskId);
    if (started.length > 0) {
      await waitForTasks("the started tasks stop", (snapshot) =>
        started.every((taskId) => snapshot.tasks.find((task) => task.id === taskId)?.state !== "running"),
      ).catch(() => undefined);
    }
    let deleted = 0;
    for (const taskId of started) {
      await call("closeTask", taskId);
      if (await call("deleteTask", taskId)) deleted += 1;
    }
    return { deleted };
  }

  return {
    page,
    session,
    started,
    listTasks,
    readTask,
    readAgent,
    requireConcurrentAgent,
    setTaskLimit,
    startTask,
    waitForTasks,
    cleanUp,
  };
}

export function taskIn(snapshot: AgentTasksSnapshot, taskId: string): AgentTask {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  assert.ok(task, `Task ${taskId} is not in the list.`);
  return task;
}

/** The text of every message in a task's history, joined. */
export function historyText(conversation: ConversationSnapshot): string {
  return conversation.messages.map((message) => message.text).join("\n");
}

/** Writes `.openbot-build/<name>/report.json` and prints the report. */
export function writeReport(name: string, report: { passed: boolean }): void {
  const out = resolve(import.meta.dirname, "../.openbot-build", name);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
