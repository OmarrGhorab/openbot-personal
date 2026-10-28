// @vitest-environment node
import { workspaceOnlySupported } from "@openbot/contracts/agent-providers";
import {
  type AgentModelOption,
  type AgentProviderId,
  RAVEN_STACK_TEAM_ROLES,
  RAVEN_STACK_TEAM_TEMPLATE_ID,
  type RavenTeamTemplate,
  ravenTeamPlatformName,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { buildRavenTeamPlan, ravenTeamPlanReady, readRavenTeamNamedModels } from "./raven-team-plan";

// Failure modes: a read-only role on a provider that cannot run Workspace only here starts anyway and
// its message never runs; Full access given on the confirm card does not clear the question; a write
// role, or a provider with its own sandbox, or macOS, is asked for nothing.
const TEMPLATE: RavenTeamTemplate = {
  id: RAVEN_STACK_TEAM_TEMPLATE_ID,
  name: "Raven Stack team",
  builtIn: true,
  roles: RAVEN_STACK_TEAM_ROLES.map((role) => ({ ...role, skills: [...role.skills] })),
  createdAt: "Wed 2026-10-28 3:00 AM EEST (UTC+03:00)",
  updatedAt: "Wed 2026-10-28 3:00 AM EEST (UTC+03:00)",
};

function model(provider: AgentProviderId, id: string): AgentModelOption {
  return {
    provider,
    id,
    name: id,
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  };
}

const MODELS = [model("codex", "gpt-6-sol"), model("opencode", "opencode/big-pickle")];

function plan(brief: string, options: { platform?: string; fullAccess?: string[] } = {}) {
  const platform = options.platform ?? "linux";
  return buildRavenTeamPlan({
    template: TEMPLATE,
    brief,
    named: readRavenTeamNamedModels(brief, TEMPLATE.roles),
    overrides: {},
    models: MODELS,
    preferredProvider: "codex",
    ...(options.fullAccess ? { fullAccess: options.fullAccess } : {}),
    workspaceOnlySupported: (provider) => workspaceOnlySupported(provider, platform),
    platform,
  });
}

const OPENCODE_REVIEWER = "Ticket 7. Builder: gpt-6-sol. Reviewer: opencode/big-pickle. Quality: gpt-6-sol.";

describe("Raven Stack team plan: Workspace only access", () => {
  it("asks about a read-only role on a provider that cannot run Workspace only on Linux", () => {
    const result = plan(OPENCODE_REVIEWER);
    expect(result.accessProblems).toEqual([{ roleId: "reviewer", provider: "opencode", platform: "linux" }]);
    expect(ravenTeamPlanReady(result)).toBe(false);
    expect(result.roles.find((role) => role.roleId === "reviewer")?.fullAccess).toBe(false);
  });

  it("clears the question when the user gives the role Full access", () => {
    const result = plan(OPENCODE_REVIEWER, { fullAccess: ["reviewer"] });
    expect(result.accessProblems).toEqual([]);
    expect(ravenTeamPlanReady(result)).toBe(true);
    const reviewer = result.roles.find((role) => role.roleId === "reviewer");
    // The role stays read-only in its brief; only its agent access is Full.
    expect(reviewer).toMatchObject({ access: "read-only", fullAccess: true, provider: "opencode" });
  });

  it("asks nothing on macOS, for a write role, or for a provider with its own sandbox", () => {
    expect(plan(OPENCODE_REVIEWER, { platform: "darwin" }).accessProblems).toEqual([]);
    expect(plan("Ticket 7. Builder: opencode/big-pickle.").accessProblems).toEqual([]);
    const codex = plan("Ticket 7. Builder: gpt-6-sol. Reviewer: gpt-6-sol.");
    expect(codex.accessProblems).toEqual([]);
    expect(codex.roles.find((role) => role.roleId === "builder")?.fullAccess).toBe(true);
    expect(codex.roles.find((role) => role.roleId === "reviewer")?.fullAccess).toBe(false);
  });

  it("lists every read-only role on such a provider", () => {
    const result = plan("Ticket 7. Architect: opencode/big-pickle. Builder: gpt-6-sol. Quality: opencode/big-pickle.");
    expect(result.accessProblems.map((problem) => problem.roleId)).toEqual(["architect", "quality"]);
  });
});

describe("workspaceOnlySupported", () => {
  it("runs a confined-process provider Workspace only on macOS only", () => {
    expect(workspaceOnlySupported("opencode", "linux")).toBe(false);
    expect(workspaceOnlySupported("opencode", "win32")).toBe(false);
    expect(workspaceOnlySupported("opencode", "darwin")).toBe(true);
    expect(workspaceOnlySupported("codex", "linux")).toBe(true);
    expect(workspaceOnlySupported("claude", "win32")).toBe(true);
  });

  it("names the system in the question", () => {
    expect(ravenTeamPlatformName("linux")).toBe("Linux");
    expect(ravenTeamPlatformName("win32")).toBe("Windows");
    expect(ravenTeamPlatformName("freebsd")).toBeNull();
  });
});
