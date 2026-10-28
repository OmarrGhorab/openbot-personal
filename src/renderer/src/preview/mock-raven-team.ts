// The Raven Stack team group of the preview: templates and jobs in memory. No agent runs, so a started
// job stays where it starts. The plan reads `Role: model` pairs the same way the runtime does, over a
// short list of models, so the confirm card and the team view show real shapes.

import {
  type OpenBotDesktopApi,
  RAVEN_STACK_TEAM_ROLES,
  RAVEN_STACK_TEAM_TEMPLATE_ID,
  type RavenTeamChanged,
  type RavenTeamJob,
  type RavenTeamPlan,
  type RavenTeamPlanRole,
  type RavenTeamRoleRun,
  type RavenTeamTemplate,
} from "@openbot/contracts/ipc";

type RavenTeamApi = OpenBotDesktopApi["ravenTeam"];

const PREVIEW_MODELS = [
  { id: "gpt-6-luna", provider: "codex" },
  { id: "claude-sonnet-5-5", provider: "claude" },
] as const;

const BUILT_IN: RavenTeamTemplate = {
  id: RAVEN_STACK_TEAM_TEMPLATE_ID,
  name: "Raven Stack team",
  builtIn: true,
  roles: RAVEN_STACK_TEAM_ROLES.map((role) => ({ ...role, skills: [...role.skills] })),
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
};

export function mockRavenTeam(): RavenTeamApi & { emitChanged: (jobId: string | null) => void } {
  let templates: RavenTeamTemplate[] = [];
  let jobs: RavenTeamJob[] = [];
  const listeners = new Set<(payload: RavenTeamChanged) => void>();
  const emitChanged = (jobId: string | null) => {
    for (const listener of listeners) listener({ jobId });
  };
  const allTemplates = () => [BUILT_IN, ...templates];
  const now = () => new Date().toISOString();

  function plan(input: { templateId: string; brief: string; models?: Record<string, string> }): RavenTeamPlan {
    const template = allTemplates().find((candidate) => candidate.id === input.templateId) ?? BUILT_IN;
    const named = new Map<string, string>();
    for (const role of template.roles) {
      const label = role.label.toLowerCase();
      const match = new RegExp(`${label}\\s*:\\s*([A-Za-z0-9][A-Za-z0-9._:/\\[\\],=+-]*)`, "i").exec(input.brief);
      if (match?.[1]) named.set(role.id, match[1].replace(/\.+$/u, ""));
    }
    for (const [roleId, model] of Object.entries(input.models ?? {})) named.set(roleId, model);
    const unknownModels: RavenTeamPlan["unknownModels"] = [];
    const roles: RavenTeamPlanRole[] = [];
    for (const role of template.roles) {
      const chosen = named.get(role.id) ?? role.defaultModel ?? PREVIEW_MODELS[0].id;
      if (role.optional && !named.has(role.id)) continue;
      const option = PREVIEW_MODELS.find((candidate) => candidate.id === chosen);
      if (!option) {
        unknownModels.push({ roleId: role.id, model: chosen });
        continue;
      }
      roles.push({
        roleId: role.id,
        label: role.label,
        model: option.id,
        provider: option.provider,
        access: role.access,
        skills: [...role.skills],
        optional: role.optional,
        named: named.has(role.id),
      });
    }
    const builder = roles.find((role) => role.roleId === "builder");
    const warnings = roles
      .filter((role) => role.skills.includes("verify") || role.skills.includes("quality"))
      .filter((role) => builder && role.model === builder.model)
      .map((role) => ({
        kind: "same-model" as const,
        roleId: role.roleId,
        builderRoleId: "builder",
        model: role.model,
      }));
    return {
      templateId: template.id,
      brief: input.brief,
      roles,
      warnings,
      unknownRoles: [],
      unknownModels,
      fallbackModel: null,
    };
  }

  return {
    listTemplates: async () => allTemplates(),
    saveTemplate: async (input) => {
      if (input.id === RAVEN_STACK_TEAM_TEMPLATE_ID) throw new Error("The built-in team template cannot be changed.");
      const existing = templates.find((template) => template.id === input.id);
      const id = existing?.id ?? input.id ?? `preview-team-${templates.length + 1}`;
      const saved: RavenTeamTemplate = {
        id,
        name: input.name,
        builtIn: false,
        roles: input.roles.map((role) => ({ ...role, skills: [...role.skills] })),
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
      };
      templates = [...templates.filter((template) => template.id !== id), saved];
      emitChanged(null);
      return allTemplates();
    },
    deleteTemplate: async (templateId) => {
      templates = templates.filter((template) => template.id !== templateId);
      emitChanged(null);
      return allTemplates();
    },
    plan: async (input) => plan(input),
    start: async (input) => {
      const planned = plan(input);
      const at = now();
      const roles: RavenTeamRoleRun[] = planned.roles.map((role) => ({
        roleId: role.roleId,
        label: role.label,
        agentId: null,
        taskId: null,
        threadId: null,
        provider: role.provider,
        model: role.model,
        access: role.access,
        state: "waiting",
        verdict: null,
        score: null,
        commit: null,
        fails: 0,
        updatedAt: at,
      }));
      const job: RavenTeamJob = {
        id: `preview-job-${jobs.length + 1}`,
        templateId: planned.templateId,
        brief: planned.brief,
        state: "running",
        headCommit: null,
        fixRounds: 0,
        roundCap: 3,
        fallbackModel: null,
        question: null,
        roles,
        createdAt: at,
        updatedAt: at,
      };
      jobs = [job, ...jobs];
      emitChanged(job.id);
      return job;
    },
    listJobs: async () => jobs,
    setRoleModel: async (input) => {
      const job = jobs.find((candidate) => candidate.id === input.jobId);
      if (!job) throw new Error("The team job was not found.");
      const option = PREVIEW_MODELS.find((candidate) => candidate.id === input.model);
      if (!option) throw new Error(`The model "${input.model}" is not available.`);
      job.roles = job.roles.map((role) =>
        role.roleId === input.roleId
          ? { ...role, model: option.id, provider: option.provider, updatedAt: now() }
          : role,
      );
      emitChanged(job.id);
      return job;
    },
    stop: async (jobId) => {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error("The team job was not found.");
      job.state = "stopped";
      emitChanged(job.id);
      return job;
    },
    resume: async (jobId) => {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error("The team job was not found.");
      if (job.state === "stopped") job.state = "running";
      emitChanged(job.id);
      return job;
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emitChanged,
  };
}
