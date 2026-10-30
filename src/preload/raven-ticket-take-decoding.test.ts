import { describe, expect, it } from "vitest";
import { parseTakeRavenTicket } from "../main/ipc/raven-team-inputs";
import { decodeRavenTicketTake } from "./raven-team-decoding";

// Chat (#200): the take request crosses the renderer-to-main boundary both ways.
describe("decodeRavenTicketTake", () => {
  it("accepts each outcome", () => {
    const taken = { outcome: "taken", jobId: "job-1", ticketId: "t-1", key: "PROJ-482", provider: "jira", already: false };
    expect(decodeRavenTicketTake(taken)).toEqual(taken);
    expect(decodeRavenTicketTake({ outcome: "connect", key: "PH-88", provider: "linear" })).toMatchObject({
      outcome: "connect",
    });
    expect(decodeRavenTicketTake({ outcome: "none" })).toEqual({ outcome: "none" });
    expect(decodeRavenTicketTake({ outcome: "failed", key: "PROJ-1", reason: "No type." })).toMatchObject({
      outcome: "failed",
    });
  });

  it("rejects a malformed answer", () => {
    expect(() => decodeRavenTicketTake({ outcome: "taken", jobId: "", ticketId: "t", key: "K-1", provider: null, already: false })).toThrow();
    expect(() => decodeRavenTicketTake({ outcome: "connect", key: "K-1", provider: "trello" })).toThrow();
    expect(() => decodeRavenTicketTake({ outcome: "done" })).toThrow();
    expect(() => decodeRavenTicketTake(null)).toThrow();
  });
});

describe("parseTakeRavenTicket", () => {
  it("keeps the agent and the message, and cuts a long message", () => {
    expect(parseTakeRavenTicket({ agentId: "agent-1", text: "fix PROJ-1" })).toEqual({ agentId: "agent-1", text: "fix PROJ-1" });
    expect(parseTakeRavenTicket({ agentId: "agent-1", text: "x".repeat(30_000) }).text).toHaveLength(20_000);
  });

  it("rejects a request without an agent or a message", () => {
    expect(() => parseTakeRavenTicket({ text: "fix PROJ-1" })).toThrow();
    expect(() => parseTakeRavenTicket({ agentId: "agent-1", text: "  " })).toThrow();
    expect(() => parseTakeRavenTicket({ agentId: "agent-1", text: 42 })).toThrow();
    expect(() => parseTakeRavenTicket("fix PROJ-1")).toThrow();
  });
});
