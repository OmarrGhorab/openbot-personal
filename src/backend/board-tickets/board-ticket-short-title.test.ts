import { describe, expect, it } from "vitest";
import { shortTicketTitle } from "./board-ticket-team-follower";

describe("ticket 251: short card titles", () => {
  it("keeps the first sentence", () => {
    expect(
      shortTicketTitle(
        "Fix sub(5,2) returning -3 in /workspace/obp-factory/sub.js. Reproduce with: node test-sub.mjs (FAIL). Do not push.",
      ),
    ).toBe("Fix sub(5,2) returning -3 in /workspace/obp-factory/sub.js");
  });
  it("cuts a long sentence at a word", () => {
    const title = shortTicketTitle(`Make ${"the very long helper ".repeat(10)}work`);
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/ …$/u);
  });
  it("keeps a short title", () => {
    expect(shortTicketTitle("mul(3,4) returns 7")).toBe("mul(3,4) returns 7");
  });
});
