// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";

// Failure mode (#262): a ticket does not say which worktree and branch its agent works in, and Start
// gives the work thread no ticket title to name its branch from.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("starts a ticket with its title and shows its worktree and branch", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-worktree-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const titles: (string | undefined)[] = [];
  const board = new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async (_agentId, _text, ticket) => {
      titles.push(ticket?.title);
      return { id: "task-1", threadId: "thread-1", state: "running" };
    },
    worktreeOf: (taskId) => (taskId === "task-1" ? { path: "/repo/.openbot/worktrees/1", branch: "ticket/a-1" } : null),
  });
  const backlog = board.create({ title: "Fix sub", body: "Repo: /repo", status: "backlog", agentId: null });
  expect(board.get(backlog.id)?.worktree).toBeUndefined();
  const started = await board.start({ ticketId: backlog.id, agentId: "chief" });
  expect(titles).toEqual(["Fix sub"]);
  expect(started.worktree).toEqual({ path: "/repo/.openbot/worktrees/1", branch: "ticket/a-1" });
  expect(board.list()[0]?.worktree?.branch).toBe("ticket/a-1");
});
