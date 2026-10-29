// @vitest-environment node
import { describe, expect, it } from "vitest";
import { approvalCommandLine, classifyApprovalRisk } from "./action-risk";

// Failure modes: an OpenCode (ACP) tool input reaches the approval card or the audit log as its
// JSON instead of the command line; a plain command, or JSON without a command, is changed.
describe("approval command line", () => {
  it("reads the command line from an ACP tool input", () => {
    expect(approvalCommandLine('{"command":"git status","description":"Run git status","cwd":"/tmp/w"}')).toBe(
      "git status",
    );
    expect(approvalCommandLine('{"cmd":["git","push","origin","main"]}')).toBe("git push origin main");
  });

  it("keeps a plain command and JSON without a command as they are", () => {
    expect(approvalCommandLine("bun test src/backend")).toBe("bun test src/backend");
    expect(approvalCommandLine('{"path":"/tmp/w"}')).toBe('{"path":"/tmp/w"}');
    expect(approvalCommandLine("{not json")).toBe("{not json");
  });

  it("rates the command line inside the input, not the JSON", () => {
    expect(classifyApprovalRisk({ kind: "command", command: '{"command":"git status"}' }).level).toBe("low");
    expect(classifyApprovalRisk({ kind: "command", command: '{"command":"git push origin main"}' }).level).toBe("high");
  });
});
