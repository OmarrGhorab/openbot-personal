// @vitest-environment node
import { expect, it } from "vitest";
import { failureText } from "./channel-service";

// Failure mode (ticket 234): every failed channel run said "The agent could not complete this task."
it("keeps the turn's own failure reason and falls back only without one", () => {
  expect(failureText("  429 Too Many\nRequests ")).toBe("429 Too Many Requests");
  expect(failureText(null)).toBe("The agent could not complete this task.");
  expect(failureText("")).toBe("The agent could not complete this task.");
});
