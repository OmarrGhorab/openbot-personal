// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";

// Failure mode (ticket 248): Request changes on a ticket in review sent to a run of the wrong agent (after a
// reassign) or to a closed run, failed with "This task is not available", and the comment was lost.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function board(options: { owner?: string; refuse?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-changes-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const sent: { agentId: string; taskId: string | null; text: string }[] = [];
  const starts: { agentId: string; text: string }[] = [];
  const service = new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async (agentId, text) => {
      starts.push({ agentId, text });
      return { id: `task-${starts.length}`, threadId: `thread-${starts.length}`, state: "running" };
    },
    sendToWorkThread: async (agentId, taskId, text) => {
      if (options.refuse) throw new Error("This task is not available.");
      sent.push({ agentId, taskId, text });
    },
    taskOwner: () => options.owner ?? null,
  });
  return { service, sent, starts };
}

it("sends the changes to the ticket's run, under the agent that owns it, and moves it to Running", async () => {
  const { service, sent } = await board({ owner: "planner" });
  const ticket = await service.start({ title: "sub(5,2)", body: "", agentId: "planner" });
  service.move({ ticketId: ticket.id, status: "needs_review" });
  const after = await service.start({ ticketId: ticket.id, agentId: "planner", changes: "Handle negatives" });
  expect(sent).toEqual([{ agentId: "planner", taskId: "task-1", text: "Handle negatives" }]);
  expect(after.status).toBe("running");
  expect(service.events(ticket.id).some((event) => event.kind === "comment" && event.text === "Handle negatives")).toBe(
    true,
  );
});

it("starts a new run with the request when the old run cannot take it", async () => {
  const { service, starts } = await board({ refuse: true });
  const ticket = await service.start({ title: "sub(5,2)", body: "", agentId: "planner" });
  service.move({ ticketId: ticket.id, status: "needs_review" });
  const after = await service.start({ ticketId: ticket.id, agentId: "planner", changes: "Handle negatives" });
  expect(starts).toHaveLength(2);
  expect(starts[1]?.text).toContain("Handle negatives");
  expect(starts[1]?.text).toContain("thread-1");
  expect(after.taskId).toBe("task-2");
  expect(after.status).toBe("running");
});

it("throws when no run can start, so the view keeps the text", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-changes-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const service = new BoardTicketService({ store: new BoardTicketStore(database), changed: () => undefined });
  const ticket = service.create({ title: "sub(5,2)", body: "", status: "needs_review", agentId: "planner" });
  await expect(service.start({ ticketId: ticket.id, agentId: "planner", changes: "x" })).rejects.toThrow();
  expect(service.events(ticket.id).some((event) => event.kind === "comment")).toBe(false);
});
