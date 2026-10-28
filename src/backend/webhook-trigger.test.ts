// @vitest-environment node
import { describe, expect, it } from "vitest";
import { webhookRunInstruction } from "./webhook-trigger";

// Secret redaction on the send path of a webhook event to the agent. The event is data from an
// error tracker, and it can quote a credential. The instruction must not carry the credential, and
// it must keep the event fields that the agent needs.
const GITHUB_TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB";
const ENVELOPE = {
  version: 1 as const,
  id: "delivery-1",
  routineId: "routine-1",
  type: "error.created",
  occurredAt: "2026-10-28T09:00:00.000Z",
  receivedAt: "2026-10-28T09:00:01.000Z",
  data: {
    title: "TypeError: cannot read properties of undefined",
    request: { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } },
    culprit: "src/backend/routine-store.ts",
  },
};

describe("webhookRunInstruction", () => {
  it("keeps the routine instruction and the event markers", () => {
    const instruction = webhookRunInstruction("Fix the error.", ENVELOPE);
    expect(instruction.startsWith("Fix the error.\n")).toBe(true);
    expect(instruction).toContain("--- external event input ---");
    expect(instruction).toContain("--- end of external event input ---");
  });

  it("does not pass a credential from the event to the agent", () => {
    const instruction = webhookRunInstruction("Fix the error.", ENVELOPE);
    expect(instruction).not.toContain(GITHUB_TOKEN);
  });

  it("keeps the fields of the event that a fix needs", () => {
    const instruction = webhookRunInstruction("Fix the error.", ENVELOPE);
    expect(instruction).toContain("TypeError: cannot read properties of undefined");
    expect(instruction).toContain("src/backend/routine-store.ts");
    expect(instruction).toContain("delivery-1");
  });
});
