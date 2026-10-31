import { describe, expect, it } from "vitest";
import { roleBrief, ticketIsLocalOnly } from "./raven-team-briefs";

const base = { jobId: "job-1", roleId: "builder", label: "Builder", skills: ["build"], access: "write" as const };

describe("ticket 250: a local-only ticket", () => {
  it("is read from the ticket text", () => {
    expect(ticketIsLocalOnly("Repo: /workspace/obp-factory (local git, no remote; never push).")).toBe(true);
    expect(ticketIsLocalOnly("Do not push.")).toBe(true);
    expect(ticketIsLocalOnly("Fix the sum and open a pull request.")).toBe(false);
  });

  it("gives the Builder no push and no pull request", () => {
    const brief = roleBrief({ ...base, ticket: "Fix add.js. Do not push." });
    expect(brief).toContain("do not push and do not open a pull request");
    expect(brief).toContain('"pr":""');
    expect(brief).not.toContain("open the pull request and get CI green");
    expect(brief).not.toContain("commits and pushes");
  });

  it("keeps the pull request for a normal ticket", () => {
    const brief = roleBrief({ ...base, ticket: "Fix add.js." });
    expect(brief).toContain("open the pull request and get CI green");
  });
});
