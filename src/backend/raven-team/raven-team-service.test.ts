// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentModelOption, AgentProviderId } from "@openbot/contracts/ipc";
import { RAVEN_STACK_TEAM_TEMPLATE_ID } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { type RavenTeamAgents, RavenTeamService } from "./raven-team-service";
import { RavenTeamStore } from "./raven-team-store";

// Failure modes: a read-only role whose provider cannot run Workspace only here gets its message
// sent anyway, and the job shows Working forever with no question; Full access, given from the
// question or in the agent settings, does not send the message that waited; a message that did not
// start leaves the role Working.
interface FakeAgent {
  id: string;
  name: string;
  provider: AgentProviderId;
  model: string;
  access: "full" | "workspace";
  reasoningEffort?: string;
}

interface Sent {
  agentId: string;
  text: string;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function option(provider: AgentProviderId, id: string): AgentModelOption {
  return {
    provider,
    id,
    name: id,
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  };
}

const MODELS = [
  { ...option("codex", "gpt-6-sol"), supportedReasoningEfforts: ["low", "medium", "high"] },
  option("codex", "gpt-6-luna"),
  option("opencode", "opencode/big-pickle"),
] satisfies AgentModelOption[];
/** The fake computer: OpenCode cannot run Workspace only, as on Linux. */
const supported = (provider: AgentProviderId) => provider !== "opencode";

async function harness() {
  const root = mkdtempSync(join(tmpdir(), "raven-team-service-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const agents: FakeAgent[] = [];
  const sent: Sent[] = [];
  const replies = new Map<string, string>();
  let tasks = 0;
  const fake = {
    listAgents: () => agents,
    createAgent: (input: { name: string; provider: AgentProviderId; model: string; reasoningEffort?: string }) =>
      Effect.sync(() => {
        const agent: FakeAgent = {
          id: `agent-${agents.length + 1}`,
          name: input.name,
          provider: input.provider,
          model: input.model,
          access: "full",
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        };
        agents.push(agent);
        return agent;
      }),
    updateAgent: (input: {
      agentId: string;
      access?: FakeAgent["access"];
      provider?: AgentProviderId;
      model?: string;
      reasoningEffort?: string;
    }) =>
      Effect.sync(() => {
        const agent = agents.find((candidate) => candidate.id === input.agentId);
        if (!agent) throw new Error("no agent");
        if (input.access) agent.access = input.access;
        if (input.reasoningEffort) agent.reasoningEffort = input.reasoningEffort;
        if (input.provider) agent.provider = input.provider;
        if (input.model) agent.model = input.model;
        return agent;
      }),
    startTask: (input: { agentId: string; text: string }) =>
      Effect.sync(() => {
        tasks += 1;
        sent.push({ agentId: input.agentId, text: input.text });
        return { id: `task-${tasks}`, threadId: `thread-${tasks}` };
      }),
    sendMessage: (input: { agentId: string; text: string }) =>
      Effect.sync(() => {
        sent.push({ agentId: input.agentId, text: input.text });
      }),
    pauseTask: () => Effect.void,
    resumeTask: () => Effect.void,
    stopTask: () => Effect.void,
    readTask: (_agentId: string, taskId: string) => ({
      messages: [{ author: "assistant", text: replies.get(taskId) ?? "" }],
    }),
    listModels: () => MODELS,
    preferredProvider: () => "codex" as const,
  };
  const team = new RavenTeamService({
    store: new RavenTeamStore(database),
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: A test fake carries only the fields the team reads.
    agents: fake as unknown as RavenTeamAgents,
    changed: () => {},
    platform: "linux",
    workspaceOnlySupported: supported,
  });
  const agentOf = (label: string) => agents.find((agent) => agent.name.startsWith(`Raven ${label} `));
  const job = (jobId: string) => {
    const found = team.listJobs().find((candidate) => candidate.id === jobId);
    if (!found) throw new Error("no job");
    return found;
  };
  /** A role's turn ends with this reply. */
  const reply = async (jobId: string, roleId: string, text: string) => {
    const role = job(jobId).roles.find((candidate) => candidate.roleId === roleId);
    if (!role?.taskId || !role.threadId || !role.agentId) throw new Error(`${roleId} has no task`);
    replies.set(role.taskId, text);
    const base = { agentId: role.agentId, threadId: role.threadId, turnId: `turn-${role.taskId}` };
    await Effect.runPromise(team.notice({ type: "turn-started", ...base }));
    await Effect.runPromise(team.notice({ type: "turn-completed", ...base, status: "completed" }));
  };
  const notice = (event: AgentEvent) => Effect.runPromise(team.notice(event));
  return { team, agents, sent, agentOf, job, reply, notice };
}

const COMMIT = "1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d";
const BUILT = `Built.\nRAVEN-REPORT: {"verdict":"DONE","commit":"${COMMIT}"}`;
const PLANNED = 'Plan.\nRAVEN-REPORT: {"verdict":"DONE"}';
const BRIEF = "Ticket 7: rename the helper. Builder: gpt-6-sol. Reviewer: opencode/big-pickle. Quality: gpt-6-luna.";

describe("RavenTeamService: Workspace only access that this computer cannot run", () => {
  it("refuses the start with the question, and creates nothing", async () => {
    const { team, agents } = await harness();
    const planned = team.plan({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: BRIEF });
    expect(planned.accessProblems).toEqual([{ roleId: "reviewer", provider: "opencode", platform: "linux" }]);
    const refusal = await runCauseEffect(team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: BRIEF })).then(
      () => "started",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(refusal).toContain("Reviewer can't run read-only with OpenCode on Linux");
    expect(team.listJobs()).toEqual([]);
    expect(agents).toEqual([]);
  });

  it("starts with Full access given on the confirm card", async () => {
    const { team, agentOf } = await harness();
    const started = await runCauseEffect(
      team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: BRIEF, fullAccess: ["reviewer"] }),
    );
    expect(started.state).toBe("running");
    expect(agentOf("Reviewer")?.access).toBe("full");
    expect(agentOf("Quality")?.access).toBe("workspace");
    expect(agentOf("Architect")?.access).toBe("workspace");
  });

  it("asks instead of sending when the provider changed mid-job, and sends after Full access", async () => {
    const { team, sent, agentOf, job, reply } = await harness();
    const brief = "Ticket 7: rename the helper. Builder: gpt-6-sol. Reviewer: gpt-6-luna. Quality: gpt-6-luna.";
    const started = await runCauseEffect(team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief }));
    // The user moves the Reviewer to an OpenCode model while the Architect works.
    await runCauseEffect(team.setRoleModel({ jobId: started.id, roleId: "reviewer", model: "opencode/big-pickle" }));
    await reply(started.id, "architect", PLANNED);
    await reply(started.id, "builder", BUILT);
    const asked = job(started.id);
    expect(asked.state).toBe("waiting-user");
    expect(asked.question).toEqual({ kind: "workspace-access", roleId: "reviewer", platform: "linux" });
    const reviewer = asked.roles.find((role) => role.roleId === "reviewer");
    expect(reviewer?.state).toBe("blocked");
    expect(reviewer?.taskId).toBeNull();
    const reviewerAgent = agentOf("Reviewer");
    expect(sent.some((message) => message.agentId === reviewerAgent?.id)).toBe(false);
    // The Quality role on a provider with its own sandbox is not held.
    expect(asked.roles.find((role) => role.roleId === "quality")?.state).toBe("working");

    const answered = await runCauseEffect(team.giveRoleFullAccess({ jobId: started.id, roleId: "reviewer" }));
    expect(answered.question).toBeNull();
    expect(answered.state).toBe("running");
    expect(answered.roles.find((role) => role.roleId === "reviewer")?.state).toBe("working");
    expect(reviewerAgent?.access).toBe("full");
    const resent = sent.filter((message) => message.agentId === reviewerAgent?.id);
    expect(resent).toHaveLength(1);
    expect(resent[0]?.text).toContain("You are the Reviewer of a Raven Stack team");
    expect(resent[0]?.text).toContain(COMMIT);
  });

  it("sends the waiting message when the access changes in the agent settings", async () => {
    const { team, sent, agentOf, job, reply, notice } = await harness();
    const brief = "Ticket 7. Builder: gpt-6-sol. Reviewer: gpt-6-luna. Quality: gpt-6-luna.";
    const started = await runCauseEffect(team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief }));
    await runCauseEffect(team.setRoleModel({ jobId: started.id, roleId: "reviewer", model: "opencode/big-pickle" }));
    await reply(started.id, "architect", PLANNED);
    await reply(started.id, "builder", BUILT);
    expect(job(started.id).question?.kind).toBe("workspace-access");
    const reviewerAgent = agentOf("Reviewer");
    if (!reviewerAgent) throw new Error("no reviewer agent");
    reviewerAgent.access = "full";
    // The team reads each agent again, so the event's own list does not matter.
    await notice({ type: "agents-changed", agents: [] });
    expect(job(started.id).question).toBeNull();
    expect(job(started.id).roles.find((role) => role.roleId === "reviewer")?.state).toBe("working");
    expect(sent.filter((message) => message.agentId === reviewerAgent.id)).toHaveLength(1);
  });

  it("asks when a role's message did not start, instead of Working forever", async () => {
    const { team, agentOf, job, reply, notice } = await harness();
    const brief = "Ticket 7. Builder: gpt-6-sol. Reviewer: gpt-6-luna. Quality: gpt-6-luna.";
    const started = await runCauseEffect(team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief }));
    await reply(started.id, "architect", PLANNED);
    await reply(started.id, "builder", BUILT);
    const reviewerAgent = agentOf("Reviewer");
    if (!reviewerAgent) throw new Error("no reviewer agent");
    expect(job(started.id).roles.find((role) => role.roleId === "reviewer")?.state).toBe("working");
    // The provider changed outside the team after the message was queued, and the start failed.
    reviewerAgent.provider = "opencode";
    await notice({
      type: "error",
      agentId: reviewerAgent.id,
      code: "delivery_start_failed",
      message: "Workspace only is available for this provider on macOS only.",
    });
    const asked = job(started.id);
    expect(asked.question).toEqual({ kind: "workspace-access", roleId: "reviewer", platform: "linux" });
    expect(asked.roles.find((role) => role.roleId === "reviewer")?.state).toBe("blocked");
    // Another failed start on a role that can run its access is the blocked question, not Working.
    const qualityAgent = agentOf("Quality");
    await notice({ type: "error", agentId: qualityAgent?.id ?? "", code: "delivery_start_failed", message: "x" });
    expect(job(started.id).roles.find((role) => role.roleId === "quality")?.state).toBe("blocked");
  });
});

describe("RavenTeamService: the reasoning effort of a role", () => {
  const CODEX_BRIEF = "Ticket 8: rename the helper. Builder: gpt-6-sol. Reviewer: gpt-6-luna. Quality: gpt-6-luna.";

  it("plans the chosen effort, and the model default for an effort the model does not have", async () => {
    const { team } = await harness();
    const planned = team.plan({
      templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
      brief: CODEX_BRIEF,
      efforts: { builder: "high", reviewer: "high" },
    });
    expect(planned.roles.find((role) => role.roleId === "builder")?.reasoningEffort).toBe("high");
    // gpt-6-luna has only medium, so the wanted high gives its default.
    expect(planned.roles.find((role) => role.roleId === "reviewer")?.reasoningEffort).toBe("medium");
  });

  it("starts the role agent on the chosen effort, in its own agent", async () => {
    const { team, agents, agentOf } = await harness();
    await runCauseEffect(
      team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: CODEX_BRIEF, efforts: { builder: "high" } }),
    );
    const builder = agentOf("Builder");
    expect(builder?.name).toBe("Raven Builder (gpt-6-sol, high)");
    expect(builder?.reasoningEffort).toBe("high");
    // A role on its model's default effort keeps the plain name, so earlier agents are reused.
    expect(agentOf("Reviewer")?.name).toBe("Raven Reviewer (gpt-6-luna)");
    // A second job on another effort does not change the effort of the first job's agent.
    await runCauseEffect(
      team.start({ templateId: RAVEN_STACK_TEAM_TEMPLATE_ID, brief: CODEX_BRIEF, efforts: { builder: "low" } }),
    );
    const builders = agents.filter((agent) => agent.name.startsWith("Raven Builder "));
    expect(builders.map((agent) => [agent.name, agent.reasoningEffort])).toEqual([
      ["Raven Builder (gpt-6-sol, high)", "high"],
      ["Raven Builder (gpt-6-sol, low)", "low"],
    ]);
  });
});
