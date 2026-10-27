// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const IMPORTED_THREAD = "history-test-thread";
const STARTED = "2026-10-01T09:00:00.000Z";
const SENT = "2026-10-01T10:00:00.000Z";

async function createDatabase(): Promise<OpenBotDatabase> {
  const root = await mkdtemp(join(tmpdir(), "openbot-db-history-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  return database;
}

function testAgent(): AgentSummary {
  return {
    id: "chief",
    provider: "codex",
    name: "Chief",
    title: "Coordinator",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: "openbot-thread-chief",
    workspacePath: "/tmp/openbot-chief",
    preview: "",
    updatedAt: "2026-08-18T10:00:01.000Z",
    avatarSeed: "chief",
    avatarHue: null,
    avatarUrl: null,
  };
}

const MESSAGES: ConversationMessage[] = [
  { id: "m1", author: "user", text: "hello", createdAt: SENT, status: "completed" },
  {
    id: "m2",
    author: "agent",
    text: "hi",
    createdAt: "2026-10-01T10:00:01.000Z",
    status: "interrupted",
    senderAgentId: "chief",
  },
];

describe("OpenBotDatabase imported history", () => {
  it("writes an imported thread once, keeps its title, and lists it beside the agent's own chat", async () => {
    const database = await createDatabase();
    const agent = testAgent();
    database.replaceAgents("history-agent", [agent], "agents.imported");

    const write = (messages: ConversationMessage[], title: string) =>
      database.persistConversation(
        { agentId: agent.id, threadId: IMPORTED_THREAD, activeTurnId: null, revision: 0, messages },
        "instance-transfer.history-imported",
        {},
        undefined,
        { title, createdAt: STARTED },
      );
    write(MESSAGES, "Imported");
    // A second import of the same thread replaces its messages in place and keeps the first title.
    write(
      [
        { id: "m1", author: "user", text: "hello", createdAt: SENT, status: "completed" },
        {
          id: "m2",
          author: "agent",
          text: "hi again",
          createdAt: "2026-10-01T10:00:01.000Z",
          status: "interrupted",
          senderAgentId: "chief",
        },
      ],
      "Renamed on the other computer",
    );

    const snapshot = database.readConversation(agent.id, IMPORTED_THREAD);
    expect(snapshot.messages.map((message) => [message.id, message.text])).toEqual([
      ["m1", "hello"],
      ["m2", "hi again"],
    ]);
    expect(snapshot.activeTurnId).toBeNull();

    const threads = database.listAgentThreads(agent.id);
    expect(threads.find((thread) => thread.threadId === IMPORTED_THREAD)).toMatchObject({
      title: "Imported",
      createdAt: STARTED,
    });
    expect(threads.map((thread) => thread.threadId)).toContain(agent.threadId);
    database.close();
  });
});
