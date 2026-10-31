import { describe, expect, it, vi } from "vitest";
import { AttentionRegistry, type AttentionRegistryOptions } from "./attention-registry";
import { isReadOnlyCommand, PLAN_ONLY_REFUSAL, planOnlyRefuses } from "./plan-only";

describe("ticket 265: plan-only commands", () => {
  it("lets reads through", () => {
    for (const command of [
      "git status",
      "git diff --stat",
      "git log --oneline -5",
      "git branch --show-current",
      "ls -la src && cat package.json | head -20",
      "rg div src 2>/dev/null",
      "find . -name '*.ts'",
      "pwd",
    ])
      expect(isReadOnlyCommand(command), command).toBe(true);
  });

  it("refuses writes, git changes and unknown commands", () => {
    for (const command of [
      "echo 'export const div' > div.js",
      "cat a >> b",
      "git commit -am wip",
      "git checkout -b x",
      "git branch -D main",
      "git push",
      "rm -rf src",
      "node test-div.mjs",
      "sed -i s/a/b/ x.js",
      "find . -delete",
      "ls $(rm x)",
      "touch div.js",
      "",
    ])
      expect(isReadOnlyCommand(command), command).toBe(false);
  });

  it("refuses every file edit and grant", () => {
    expect(planOnlyRefuses({ kind: "file-change", command: null })).toBe(true);
    expect(planOnlyRefuses({ kind: "permissions", command: null })).toBe(true);
    expect(planOnlyRefuses({ kind: "command", command: "git status" })).toBe(false);
  });
});

function registry(planOnly: boolean) {
  const respond = vi.fn();
  const emit = vi.fn();
  const record = vi.fn();
  const options = {
    conversation: { agentForThread: () => "planner", publicThreadId: (_agent: string, thread: string) => thread },
    browser: {},
    hostedSites: {},
    routines: { markNeedsAttention: vi.fn() },
    // Full access everywhere: before ticket 265 this answered every approval of the Planner with "accept".
    approvalAutomation: { autoApproves: () => true },
    autonomy: { answersWithoutAsking: () => true, record },
    planOnly: () => planOnly,
    emit,
    emitError: vi.fn(),
    emitRuntimeSnapshot: vi.fn(),
  };
  // The stubs fill only what an approval reads.
  const attention = new AttentionRegistry(
    Object.assign(Object.create(null), options) satisfies object & AttentionRegistryOptions,
  );
  const client = { respond, respondError: vi.fn(), running: true };
  return { attention, client, respond, emit, record };
}

const fileChange = { id: 7, method: "item/fileChange/requestApproval", params: { threadId: "t", turnId: "u" } };
const command = (line: string) => ({
  id: 8,
  method: "item/commandExecution/requestApproval",
  params: { threadId: "t", turnId: "u", command: line },
});

describe("ticket 265: a Plan only agent's approvals", () => {
  it("refuses a file edit at once, even with Full access, and records it", () => {
    const { attention, client, respond, emit, record } = registry(true);
    attention.surfaceApproval(Object.assign(client), Object.assign(fileChange), "file-change");
    expect(respond).toHaveBeenCalledWith(7, { decision: "decline" });
    expect(emit).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approval.declined", detail: expect.stringContaining("plan-only") }),
    );
  });

  it("refuses a writing command and allows a read", () => {
    const { attention, client, respond } = registry(true);
    attention.surfaceApproval(Object.assign(client), Object.assign(command("echo x > div.js")), "command");
    expect(respond).toHaveBeenLastCalledWith(8, { decision: "decline" });
    attention.surfaceApproval(Object.assign(client), Object.assign(command("git status")), "command");
    expect(respond).toHaveBeenLastCalledWith(8, { decision: "accept" });
  });

  it("leaves a writing agent alone", () => {
    const { attention, client, respond } = registry(false);
    attention.surfaceApproval(Object.assign(client), Object.assign(fileChange), "file-change");
    expect(respond).toHaveBeenCalledWith(7, { decision: "accept" });
  });

  it("tells the agent why", () => {
    expect(PLAN_ONLY_REFUSAL).toContain("Plan only");
  });
});
