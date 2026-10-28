// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseRows, requiredStringColumn } from "../database/database-rows";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { ProjectMemoryStore } from "./project-memory-store";

// Failure modes: a secret reaches a table through a save, an edit, or the undo slot that keeps the
// previous text; a search result shows a secret that a save stored; text that holds no secret is changed.
const PROJECT = "/work/project";
const SAMPLES = [
  { text: "Send the request with Bearer abcdef1234567890 in the header.", secret: "abcdef1234567890" },
  { text: "Staging key: api_key=sk-test-REDACT-0001 for the tests.", secret: "sk-test-REDACT-0001" },
  { text: "The login password: hunter2hunter2 works.", secret: "hunter2hunter2" },
  { text: '{"token":"tok_ABCDEFGH1234"} is the sample body.', secret: "tok_ABCDEFGH1234" },
];

let root: string;
let database: OpenBotDatabase;
let store: ProjectMemoryStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-project-memory-redaction-"));
  database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  store = new ProjectMemoryStore(database);
});

afterEach(async () => {
  database.close();
  await rm(root, { recursive: true, force: true });
});

function storedTexts(): string[] {
  return databaseRows(database.connection.prepare("SELECT text FROM project_memories").all()).map((row) =>
    requiredStringColumn(row, "text"),
  );
}

function undoSlots(): string[] {
  return databaseRows(
    database.connection.prepare("SELECT COALESCE(before_json, '') AS before FROM project_memory_undo").all(),
  ).map((row) => requiredStringColumn(row, "before"));
}

describe("project memory redaction", () => {
  it.each(SAMPLES)("stores no secret from a saved entry: $secret", ({ text, secret }) => {
    store.save({ projectKey: PROJECT, kind: "rule", text, agentId: "agent-1" });
    expect(storedTexts().join("\n")).not.toContain(secret);
    expect(storedTexts()[0]).toContain("[redacted]");
    const results = store.search(PROJECT, "header tests request", 5);
    expect(JSON.stringify(results.memories)).not.toContain(secret);
  });

  it.each(SAMPLES)("stores no secret from an edit, and the undo slot keeps no secret: $secret", ({ text, secret }) => {
    const first = store.save({
      projectKey: PROJECT,
      kind: "command",
      text: "Run bun run test:changed.",
      agentId: null,
    });
    store.save({ projectKey: PROJECT, memoryId: first.memory.id, kind: "command", text, agentId: null });
    expect(storedTexts().join("\n")).not.toContain(secret);
    expect(undoSlots().join("\n")).not.toContain(secret);
    expect(store.revert(PROJECT)).toBe(true);
    expect(storedTexts()).toEqual(["Run bun run test:changed."]);
  });

  it("keeps text that holds no secret as written", () => {
    const text = "Run bun run test:changed before you push.";
    store.save({ projectKey: PROJECT, kind: "command", text, agentId: "agent-1" });
    expect(storedTexts()).toEqual([text]);
  });
});
