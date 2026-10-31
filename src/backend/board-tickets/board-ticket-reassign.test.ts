// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardTicketEventAgents } from "@openbot/contracts/ipc";
import { afterEach, expect, it, vi } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";

// Failure mode (ticket 247): reassigning a running ticket credited the old agent's run to the new agent, and the
// new agent never started.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function board() {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-reassign-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const starts: { agentId: string; text: string }[] = [];
  const service = new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async (agentId, text) => {
      starts.push({ agentId, text });
      return { id: `task-${starts.length}`, threadId: `thread-${starts.length}`, state: "running" };
    },
  });
  return { service, starts };
}

it("keeps each past event under the agent of its time after a reassign", async () => {
  const { service } = await board();
  const ticket = await service.start({ title: "sub(5,2)", body: "", agentId: "planner" });
  service.update({ ticketId: ticket.id, progress: "Planner ran the tests" }, "agent");
  service.update({ ticketId: ticket.id, agentId: "builder2" });
  const events = service.events(ticket.id);
  const agents = boardTicketEventAgents(events);
  const progress = events.find((event) => event.kind === "progress");
  expect(progress && agents.get(progress.id)).toBe("planner");
  const last = events.at(-1);
  expect(last && agents.get(last.id)).toBe("builder2");
});

it("starts the new agent on a running ticket, with the old thread as context", async () => {
  const { service, starts } = await board();
  const ticket = await service.start({ title: "sub(5,2)", body: "", agentId: "planner" });
  service.update({ ticketId: ticket.id, agentId: "builder2" });
  await vi.waitFor(() => expect(starts).toHaveLength(2));
  expect(starts[1]?.agentId).toBe("builder2");
  expect(starts[1]?.text).toContain("thread-1");
  await vi.waitFor(() => expect(service.get(ticket.id)?.taskId).toBe("task-2"));
  expect(service.get(ticket.id)?.agentId).toBe("builder2");
});

it("waits for Start when a finished ticket is reassigned", async () => {
  const { service, starts } = await board();
  const ticket = await service.start({ title: "sub(5,2)", body: "", agentId: "planner" });
  service.move({ ticketId: ticket.id, status: "needs_review" });
  service.update({ ticketId: ticket.id, agentId: "builder2" });
  expect(starts).toHaveLength(1);
  const after = service.get(ticket.id);
  expect(after?.taskId).toBeNull();
  expect(after?.threadId).toBeNull();
});
