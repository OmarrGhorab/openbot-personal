// The Raven Stack team group of the preview: templates and jobs in memory. No agent runs, so a started
// job stays where it starts: its first role works and the others wait. The plan reads `Role: model` pairs the same way the runtime does, over a
// short list of models, so the confirm card and the team view show real shapes. A story can seed jobs.

import {
  type AgentReasoningEffort,
  type OpenBotDesktopApi,
  RAVEN_STACK_LITE_ROLES,
  RAVEN_STACK_LITE_TEMPLATE_ID,
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

/** The preview models. One has effort levels, one has none, so the page shows both kinds. */
const PREVIEW_MODELS: readonly {
  id: string;
  provider: "codex" | "claude";
  defaultEffort: AgentReasoningEffort | null;
  efforts: readonly AgentReasoningEffort[];
}[] = [
  { id: "gpt-6-luna", provider: "codex", defaultEffort: "medium", efforts: ["low", "medium", "high", "xhigh"] },
  { id: "claude-sonnet-5-5", provider: "claude", defaultEffort: null, efforts: [] },
];

const BUILT_IN: RavenTeamTemplate = {
  id: RAVEN_STACK_TEAM_TEMPLATE_ID,
  name: "Raven Stack team",
  builtIn: true,
  roles: RAVEN_STACK_TEAM_ROLES.map((role) => ({ ...role, skills: [...role.skills] })),
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
};

function previewEffort(
  option: (typeof PREVIEW_MODELS)[number],
  wanted: AgentReasoningEffort | undefined,
): AgentReasoningEffort | null {
  if (option.efforts.length === 0) return null;
  return wanted && option.efforts.includes(wanted) ? wanted : option.defaultEffort;
}

const LITE: RavenTeamTemplate = {
  id: RAVEN_STACK_LITE_TEMPLATE_ID,
  name: "Autopilot lite",
  builtIn: true,
  roles: RAVEN_STACK_LITE_ROLES.map((role) => ({ ...role, skills: [...role.skills] })),
  createdAt: BUILT_IN.createdAt,
  updatedAt: BUILT_IN.updatedAt,
};

/** The preview's work-thread limit of a role agent: two jobs run, a third waits as Queued. */
const PREVIEW_JOB_LIMIT = 2;

/** `seed`: the jobs when the preview starts, newest first. Without one, the preview starts with one running job. */
export function mockRavenTeam(
  seed?: readonly RavenTeamJob[],
): RavenTeamApi & { emitChanged: (jobId: string | null) => void } {
  let templates: RavenTeamTemplate[] = [];
  // No seed: one running job, so the team page and the Monitor's "Live now" show a team at work.
  let jobs: RavenTeamJob[] = seed
    ? seed.map((job) => ({ ...job, roles: job.roles.map((role) => ({ ...role })) }))
    : [previewRunningJob()];
  const listeners = new Set<(payload: RavenTeamChanged) => void>();
  const emitChanged = (jobId: string | null) => {
    for (const listener of listeners) listener({ jobId });
  };
  const allTemplates = () => [BUILT_IN, LITE, ...templates];
  /** Jobs that hold a slot: running or waiting for the user, and not queued. */
  const holding = () =>
    jobs.filter((job) => (job.state === "running" || job.state === "waiting-user") && !job.queued).length;
  /** The first role of a job starts working, as the service sends it the first message. */
  const begin = (job: RavenTeamJob) => {
    job.queued = false;
    job.roles = job.roles.map((role, index) => (index === 0 ? { ...role, state: "working", updatedAt: now() } : role));
    emitChanged(job.id);
  };
  /** Starts queued jobs, oldest first, while a slot is free. */
  const startQueued = () => {
    for (const job of [...jobs].reverse()) {
      if (job.queued && job.state === "running" && holding() < PREVIEW_JOB_LIMIT) begin(job);
    }
  };
  const now = () => new Date().toISOString();

  function plan(input: {
    templateId: string;
    brief: string;
    models?: Record<string, string>;
    fullAccess?: string[];
    efforts?: Record<string, AgentReasoningEffort>;
  }): RavenTeamPlan {
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
      const chosen = named.get(role.id) ?? role.defaultModel ?? PREVIEW_MODELS[0]?.id ?? "";
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
        fullAccess: role.access === "write" || (input.fullAccess ?? []).includes(role.id),
        reasoningEffort: previewEffort(option, input.efforts?.[role.id]),
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
      // The preview models run Workspace only everywhere, so the preview has no access question.
      accessProblems: [],
      fallbackModel: null,
    };
  }

  return {
    listTemplates: async () => allTemplates(),
    saveTemplate: async (input) => {
      if (input.id === RAVEN_STACK_TEAM_TEMPLATE_ID || input.id === RAVEN_STACK_LITE_TEMPLATE_ID) {
        throw new Error("The built-in team template cannot be changed.");
      }
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
      const roles: RavenTeamRoleRun[] = planned.roles.map((role, index) => ({
        roleId: role.roleId,
        label: role.label,
        agentId: null,
        taskId: null,
        threadId: null,
        provider: role.provider,
        model: role.model,
        access: role.access,
        state: index === 0 ? "working" : "waiting",
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
        queued: true,
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
      startQueued();
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
    giveRoleFullAccess: async (input) => {
      const job = jobs.find((candidate) => candidate.id === input.jobId);
      if (!job) throw new Error("The team job was not found.");
      if (job.question?.kind === "workspace-access" && job.question.roleId === input.roleId) {
        job.question = null;
        job.state = "running";
        job.roles = job.roles.map((role) =>
          role.roleId === input.roleId ? { ...role, state: "working", updatedAt: now() } : role,
        );
      }
      emitChanged(job.id);
      return job;
    },
    stop: async (jobId) => {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error("The team job was not found.");
      job.state = "stopped";
      emitChanged(job.id);
      startQueued();
      return job;
    },
    resume: async (jobId) => {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error("The team job was not found.");
      if (job.state === "stopped") job.state = "running";
      emitChanged(job.id);
      startQueued();
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

/**
 * The running job of the preview: the Architect passed, the Builder works, the Reviewer waits for the
 * user, and Quality waits for its turn. No agent runs, so the roles have no work thread.
 */
function previewRunningJob(): RavenTeamJob {
  const at = new Date().toISOString();
  const role = (roleId: string, state: RavenTeamRoleRun["state"]): RavenTeamRoleRun => {
    const definition = RAVEN_STACK_TEAM_ROLES.find((candidate) => candidate.id === roleId);
    return {
      roleId,
      label: definition?.label ?? roleId,
      agentId: null,
      taskId: null,
      threadId: null,
      provider: PREVIEW_MODELS[0]?.provider ?? "codex",
      model: PREVIEW_MODELS[0]?.id ?? "",
      access: definition?.access ?? "read-only",
      state,
      verdict: state === "passed" ? "DONE" : null,
      score: null,
      commit: null,
      fails: 0,
      updatedAt: at,
    };
  };
  return {
    id: "preview-job-running",
    templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
    brief: "PUU-145: Show running team jobs on the Monitor page\n\nList each job and its roles in Live now.",
    state: "waiting-user",
    queued: false,
    headCommit: null,
    fixRounds: 0,
    roundCap: 3,
    fallbackModel: null,
    question: { kind: "blocked", roleId: "reviewer" },
    roles: [
      role("architect", "passed"),
      role("builder", "working"),
      role("reviewer", "working"),
      role("quality", "waiting"),
    ],
    createdAt: at,
    updatedAt: at,
  };
}
