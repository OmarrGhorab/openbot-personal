// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { attachTicketEvidenceToolSchema } from "../agent-tasks/agent-tasks";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketEvidenceStore, evidenceKindOfPath } from "./board-ticket-evidence";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";

// Failure modes (#236, #264): an agent's test output, diff and screenshot never reach its ticket; a file
// type or size past the limits is kept; a thread that does not do the ticket attaches to it; a deleted
// ticket leaves its files behind.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function harness() {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-evidence-"));
  roots.push(root);
  const database = new OpenBotDatabase(join(root, "db"));
  await runCauseEffect(database.initialize());
  const store = new BoardTicketStore(database);
  const directory = join(root, "ticket-evidence");
  let changes = 0;
  const board = new BoardTicketService({
    store,
    changed: () => {
      changes += 1;
    },
    evidence: new BoardTicketEvidenceStore(store, directory),
  });
  const ticket = board.create({ title: "Fix sub", body: "", status: "running", agentId: "chief" }, "user", {
    taskId: "task-1",
    threadId: "thread-1",
  });
  return { root, board, ticket, directory, changes: () => changes };
}

it("keeps an agent's test output, diff and screenshot on its ticket, by phase", async () => {
  const { root, board, ticket, directory, changes } = await harness();
  const png = join(root, "after.png");
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  const patch = join(root, "fix.diff");
  writeFileSync(patch, "-  return b - a;\n+  return a - b;\n");
  const before = changes();
  await board.attachEvidence({ ticketId: ticket.id, phase: "before", text: "FAIL sub(5,2)=-3\nexit 1" }, "agent");
  await board.attachEvidence({ ticketId: ticket.id, phase: "after", path: patch, caption: "The fix" }, "agent");
  const shot = await board.attachEvidence({ ticketId: ticket.id, phase: "after", path: png }, "agent");
  expect(changes() - before).toBe(3);
  expect(board.evidence(ticket.id).map((item) => [item.phase, item.kind, item.actor])).toEqual([
    ["before", "test_output", "agent"],
    ["after", "diff", "agent"],
    ["after", "screenshot", "agent"],
  ]);
  expect(board.evidence(ticket.id)[1]).toMatchObject({
    caption: "The fix",
    fileName: "fix.diff",
    text: expect.stringContaining("a - b"),
  });
  expect(shot).toMatchObject({ mime: "image/png", sizeBytes: 7, text: null, fileName: "after.png" });
  expect(await board.evidenceImage(shot.id)).toMatch(/^data:image\/png;base64,/);
  expect(board.evidenceFile(shot.id)).toContain(directory);
  // The copy outlives the worktree file it came from.
  rmSync(png);
  expect(await board.evidenceImage(shot.id)).not.toBeNull();

  board.delete(ticket.id);
  await vi.waitFor(() => expect(readdirSync(directory)).toEqual([]));
});

it("refuses a file type, a size or text past the limits, and empty evidence", async () => {
  const { root, board, ticket } = await harness();
  const exe = join(root, "tool.exe");
  writeFileSync(exe, "x");
  await expect(
    board.attachEvidence({ ticketId: ticket.id, phase: "before", kind: "screenshot", path: exe }),
  ).rejects.toThrow(/file type/i);
  const big = join(root, "big.png");
  writeFileSync(big, Buffer.alloc(10 * 1024 * 1024 + 1));
  await expect(board.attachEvidence({ ticketId: ticket.id, phase: "after", path: big })).rejects.toThrow(/10 MB/);
  await expect(board.attachEvidence({ ticketId: ticket.id, phase: "after", text: "   " })).rejects.toThrow(/empty/i);
  await expect(board.attachEvidence({ ticketId: ticket.id, phase: "after", text: "x".repeat(65_537) })).rejects.toThrow(
    /characters/,
  );
  expect(board.evidence(ticket.id)).toEqual([]);
});

it("finds the ticket of a work thread or a chat that took one, and no other", async () => {
  const { board, ticket } = await harness();
  expect(board.forThread("task-1", "thread-1")?.id).toBe(ticket.id);
  expect(board.forThread("task-2", "thread-2")).toBeNull();
  const chat = board.create({ title: "Taken in chat", body: "", status: "backlog", agentId: null });
  board.bindChat(chat.id, "chief", "chief-thread");
  expect(board.forThread(null, "chief-thread")?.id).toBe(chat.id);
});

it("reads the kind from the file, and the tool needs a phase", () => {
  expect(["a.PNG", "b.webm", "c.patch", "d.log"].map(evidenceKindOfPath)).toEqual([
    "screenshot",
    "recording",
    "diff",
    "test_output",
  ]);
  expect(attachTicketEvidenceToolSchema.safeParse({ path: "a.png" }).success).toBe(false);
  expect(attachTicketEvidenceToolSchema.safeParse({ phase: "after", path: "a.png" }).success).toBe(true);
  expect(attachTicketEvidenceToolSchema.safeParse({ phase: "later", text: "x" }).success).toBe(false);
});
