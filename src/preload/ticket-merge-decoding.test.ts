import type { TicketMergeNotice } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { decodeTicketMergeNotice, decodeTicketMergeOpenedEvent } from "./ticket-merge-decoding";

const notice: TicketMergeNotice = {
  id: "merge-1",
  ticketId: "ticket-1",
  ticketKey: "PROJ-482",
  title: "Add the export button",
  prNumber: 12,
  prUrl: "https://github.com/owner/repo/pull/12",
  verdict: "PASS",
  qualityScore: 10,
  ci: "green",
  mergedAt: "2026-10-30T03:00:00.000Z",
};

describe("ticket merge decoding", () => {
  it("passes a valid notice and keeps only the contract fields", () => {
    expect(decodeTicketMergeNotice({ ...notice, diff: "secret", extra: 1 })).toEqual(notice);
    expect(decodeTicketMergeOpenedEvent({ notice: { ...notice, log: "x" }, other: true })).toEqual({ notice });
  });

  it("rejects a pull request URL that is not https", () => {
    for (const prUrl of ["http://github.com/owner/repo/pull/12", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(() => decodeTicketMergeNotice({ ...notice, prUrl })).toThrow();
    }
  });

  it("rejects a title over the limit, a bad verdict and a bad score", () => {
    expect(() => decodeTicketMergeNotice({ ...notice, title: "x".repeat(81) })).toThrow();
    expect(() => decodeTicketMergeNotice({ ...notice, verdict: "FAIL" })).toThrow();
    expect(() => decodeTicketMergeNotice({ ...notice, qualityScore: 11 })).toThrow();
    expect(() => decodeTicketMergeOpenedEvent({})).toThrow();
  });
});
