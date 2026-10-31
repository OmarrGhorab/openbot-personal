// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isWorkFolder } from "@openbot/contracts/ipc";
import { afterEach, expect, it } from "vitest";
import {
  parseCreateBoardTicket,
  parseStartBoardTicket,
  parseUpdateBoardTicket,
} from "../../main/ipc/board-ticket-inputs";
import { agentWorkFolder, workspaceWritableRoots } from "../agent/workspace-sandbox";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { migrateOpenBotDatabase } from "../openbot-database-schema";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";

// Failure modes (ticket 257): the work folder of a ticket is lost on save, on update, or on Start; the
// work thread does not get it; migration 57 changes a row; a removed folder stops the agent's turns.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function folder(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function board(started: { workFolder?: string | undefined }[] = []) {
  const database = new OpenBotDatabase(folder("board-ticket-work-folder-"));
  await runCauseEffect(database.initialize());
  return new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async (_agentId, _text, ticket) => {
      started.push({ workFolder: ticket?.workFolder });
      return { id: "task-1", threadId: "thread-1", state: "running" };
    },
  });
}

it("accepts only absolute paths as a work folder", () => {
  expect(isWorkFolder("/home/raven/repo")).toBe(true);
  expect(isWorkFolder("C:\\code\\repo")).toBe(true);
  expect(isWorkFolder("repo")).toBe(false);
  expect(isWorkFolder(" /repo")).toBe(false);
  expect(isWorkFolder("")).toBe(false);
  expect(isWorkFolder(`/${"a".repeat(4_096)}`)).toBe(false);
});

it("keeps the work folder of a ticket through create, update and clear", async () => {
  const service = await board();
  const ticket = service.create(parseCreateBoardTicket({ title: "Fix the build", workFolder: "/srv/repo" }));
  expect(service.get(ticket.id)?.workFolder).toBe("/srv/repo");
  service.update(parseUpdateBoardTicket({ ticketId: ticket.id, workFolder: "/srv/other" }));
  expect(service.get(ticket.id)?.workFolder).toBe("/srv/other");
  service.update(parseUpdateBoardTicket({ ticketId: ticket.id, workFolder: "" }));
  expect(service.get(ticket.id)?.workFolder).toBeUndefined();
  expect(() => parseCreateBoardTicket({ title: "x", workFolder: "relative/path" })).toThrow("Invalid work folder.");
});

it("gives the ticket's work folder to the work thread on Start", async () => {
  const started: { workFolder?: string | undefined }[] = [];
  const service = await board(started);
  const created = await service.start(
    parseStartBoardTicket({ agentId: "builder", title: "New", workFolder: "/srv/a" }),
  );
  expect(service.get(created.id)?.workFolder).toBe("/srv/a");
  const backlog = service.create({ title: "Later", workFolder: "/srv/b" });
  await service.start({ agentId: "builder", ticketId: backlog.id });
  expect(started.map((entry) => entry.workFolder)).toEqual(["/srv/a", "/srv/b"]);
});

it("adds the work_folder column in migration 57 and keeps every ticket", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > 56
      BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 57 failed");
    db.exec("DROP TRIGGER stop_at_version");
    db.exec(`INSERT INTO board_tickets (ticket_id, title, body, status, sort_order, status_changed_at, created_at,
      updated_at) VALUES ('t1', 'Old', '', 'backlog', 1, 'a', 'a', 'a')`);
    migrateOpenBotDatabase(db);
    const row = db.prepare("SELECT title, work_folder FROM board_tickets WHERE ticket_id = 't1'").get();
    expect(row).toEqual({ title: "Old", work_folder: null });
  } finally {
    db.close();
  }
});

it("runs the agent in its work folder only while that folder exists", () => {
  const workspace = folder("agent-workspace-");
  const repo = folder("agent-repo-");
  expect(agentWorkFolder({ workspacePath: workspace })).toBe(workspace);
  expect(agentWorkFolder({ workspacePath: workspace, workFolder: repo })).toBe(repo);
  expect(workspaceWritableRoots({ workspacePath: workspace, workFolder: repo }, "/shared")).toEqual([
    workspace,
    repo,
    "/shared",
  ]);
  const gone = join(repo, "gone");
  expect(agentWorkFolder({ workspacePath: workspace, workFolder: gone })).toBe(workspace);
  mkdirSync(gone);
  expect(agentWorkFolder({ workspacePath: workspace, workFolder: gone })).toBe(gone);
});
