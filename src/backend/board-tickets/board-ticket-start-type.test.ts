// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parseStartBoardTicket } from "../../main/ipc/board-ticket-inputs";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";

// Failure mode (ticket 259): a new ticket started from the dialog with type Bug was saved as "No type".
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function board() {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-start-type-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  return new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async () => ({ id: "task-1", threadId: "thread-1", state: "running" }),
  });
}

it("keeps the chosen type of a ticket created by Start", async () => {
  const service = await board();
  const input = parseStartBoardTicket({ agentId: "builder", title: "Add a dark mode", body: "", type: "bug" });
  expect(input.type).toBe("bug");
  const ticket = await service.start(input);
  expect(service.get(ticket.id)?.type).toBe("bug");
  expect(service.get(ticket.id)?.typeSource).toBe("user");
});

it("still detects a type when none was chosen", async () => {
  const service = await board();
  const ticket = await service.start({ agentId: "builder", title: "Bug: sub returns the wrong sign", body: "" });
  expect(service.get(ticket.id)?.typeSource).not.toBe("user");
});
