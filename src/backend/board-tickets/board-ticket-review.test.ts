// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardTicketMayMerge, boardTicketVerdicts } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { pickTicketReviewer } from "./board-ticket-review";
import { BoardTicketService } from "./board-ticket-service";
import { BoardTicketStore } from "./board-ticket-store";

// Failure modes of ticket 239: the author reviews its own code, or the same model does; a verdict on an
// old commit merges a newer one; a FAIL never reaches the author; the review loop never stops; any thread
// can give a verdict.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const AGENTS = [
  { id: "builder", name: "Builder", model: "gemini-3.8-flash" },
  { id: "twin", name: "Twin", model: "gemini-3.8-flash" },
  { id: "checker", name: "Checker", model: "opencode/flint" },
];

async function harness() {
  const root = mkdtempSync(join(tmpdir(), "board-ticket-review-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  let started = 0;
  const threads: { agentId: string; text: string }[] = [];
  const sent: { agentId: string; taskId: string | null; text: string }[] = [];
  const board = new BoardTicketService({
    store: new BoardTicketStore(database),
    changed: () => undefined,
    startWorkThread: async (agentId, text) => {
      started += 1;
      threads.push({ agentId, text });
      return { id: `task-${started}`, threadId: `thread-${started}`, state: "running" };
    },
    sendToWorkThread: async (agentId, taskId, text) => {
      sent.push({ agentId, taskId, text });
    },
    reviewers: () => AGENTS,
  });
  const ticket = await board.start({ agentId: "builder", title: "Fix sub" });
  return { board, ticket, threads, sent };
}

describe("ticket review", () => {
  it("never picks the author's agent or the author's model", () => {
    expect(pickTicketReviewer(AGENTS, { id: "builder", model: "gemini-3.8-flash" })?.id).toBe("checker");
    expect(pickTicketReviewer(AGENTS.slice(0, 2), { id: "builder", model: "gemini-3.8-flash" })).toBeNull();
  });

  it("starts the review on another agent and model, and takes a verdict only from that thread", async () => {
    const { board, ticket, threads } = await harness();

    const review = await board.requestReview(ticket.id, { pullRequest: 12, notes: "Fixed the sign" });

    expect(review.reviewerId).toBe("checker");
    expect(threads.at(-1)?.text).toContain("pull request #12");
    expect(board.get(ticket.id)?.phase).toBe("review");
    await expect(
      board.submitVerdict(review.taskId, "builder", { verdict: "PASS", headSha: "abc1234", notes: "" }),
    ).rejects.toThrow();
    await board.submitVerdict(review.taskId, "checker", { verdict: "PASS", headSha: "abc1234", notes: "Good" });
    const verdicts = boardTicketVerdicts(board.events(ticket.id));
    expect(verdicts).toMatchObject([{ verdict: "PASS", headSha: "abc1234", reviewerId: "checker" }]);
    await expect(
      board.submitVerdict(review.taskId, "checker", { verdict: "PASS", headSha: "abc1234", notes: "" }),
    ).rejects.toThrow();
  });

  it("ties a verdict to its head commit, so a stale PASS or any FAIL on the head does not merge", () => {
    const at = "2026-10-31T00:00:00.000Z";
    const pass = { verdict: "PASS" as const, headSha: "aaa1111", notes: "", reviewerId: "checker", at };
    expect(boardTicketMayMerge([pass], "aaa1111")).toBe(true);
    expect(boardTicketMayMerge([pass], "bbb2222")).toBe(false);
    expect(boardTicketMayMerge([{ ...pass, verdict: "FAIL" }, pass], "aaa1111")).toBe(false);
  });

  it("sends a FAIL to the author thread, and pauses for the person after three", async () => {
    const { board, ticket, sent } = await harness();
    for (let round = 1; round <= 3; round += 1) {
      const review = await board.requestReview(ticket.id, { pullRequest: 12 });
      const result = await board.submitVerdict(review.taskId, "checker", {
        verdict: "FAIL",
        headSha: `abc123${round}`,
        notes: "Still wrong",
      });
      expect(result).toMatchObject({ fails: round, paused: round === 3 });
    }
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ agentId: "builder", taskId: "task-1" });
    expect(board.get(ticket.id)?.status).toBe("needs_review");
  });
});

describe("ticket thread merge rule", () => {
  it("allows a merge only on a PASS for the current head", async () => {
    const { ticketThreadMergeVerdicts } = await import("../raven-team/autopilot-merge");
    const at = "2026-10-31T00:00:00.000Z";
    const notes = { verdict: "PASS+NOTES" as const, headSha: "ccc3333", notes: "nit", reviewerId: "checker", at };
    expect(ticketThreadMergeVerdicts([notes], "ccc3333")).toEqual({
      commit: "ccc3333",
      reviewer: "PASS+NOTES",
      qualityScore: null,
    });
    expect(ticketThreadMergeVerdicts([notes], "ddd4444")).toBeNull();
  });
});
