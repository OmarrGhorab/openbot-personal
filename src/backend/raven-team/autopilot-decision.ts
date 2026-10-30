import {
  type AgentModelOption,
  type AgentProviderId,
  type BoardTicketType,
  detectBoardTicketType,
  RAVEN_STACK_LITE_TEMPLATE_ID,
  RAVEN_STACK_TEAM_TEMPLATE_ID,
  type RavenAutopilotChangeSize,
  type RavenAutopilotDecision,
  type RavenAutopilotModelTier,
  type RavenAutopilotReasonCode,
  type RavenAutopilotSettings,
  type RavenAutopilotStack,
  ravenAutopilotOverride,
  ravenAutopilotPreset,
} from "@openbot/contracts/ipc";

/**
 * Autopilot's choice for one ticket, from the ticket type, the size of the change and the repository:
 *
 * - A Feature that touches many files runs the full Raven Stack team on strong models: it plans first and a
 *   second model reviews. A small Feature runs Autopilot lite.
 * - A Bug with a failing case runs a test-first team; a Bug with no failing case runs the full team, which
 *   investigates before it builds.
 * - A Chore runs Autopilot lite on small models.
 *
 * A type override of the settings wins over the table. Everything here is pure: the engine passes the
 * ticket, the models that the providers list and the settings, and stores the result on the job.
 */

/** The parts of a ticket that the decision reads. */
export interface AutopilotTicketInput {
  id: string | null;
  title: string;
  body: string;
  /** The type that the person, the sync or the detection set. Null: not set yet. */
  type: BoardTicketType | null;
  /** The repository or project of the ticket, such as `owner/repo`. */
  repo: string | null;
}

export interface AutopilotDecisionInput {
  ticket: AutopilotTicketInput;
  settings: Pick<RavenAutopilotSettings, "autoStack" | "overrides">;
  models: readonly AgentModelOption[];
  preferredProvider: AgentProviderId;
  /** The English sentence of a reason code, for the `reason` field. */
  reasonText: (code: RavenAutopilotReasonCode, files: number | null, type: BoardTicketType) => string;
  now: string;
}

/** The decision, and what the team start needs from it: the template and the model of each role. */
export interface AutopilotChoice {
  decision: RavenAutopilotDecision;
  /** Role id to model id. The key `fallback` names the model the Builder moves to after a failed round. */
  models: Record<string, string>;
}

const FALLBACK_KEY = "fallback";

const LARGE_WORDS =
  /\b(across|many files|several (files|packages|screens)|refactor|migrate|migration|redesign|rewrite|end[- ]to[- ]end|every (screen|page|package))\b/iu;
/** A failing case: steps, expected and actual results, a stack trace, or a named failing test. */
const FAILING_CASE =
  /(steps to reproduce|to reproduce|repro(duction)?\b|expected\b[\s\S]{0,200}\bactual|actual\b[\s\S]{0,200}\bexpected|stack ?trace|traceback|failing test|test fails|fails when|fails with|throws\b|TypeError|ReferenceError|AssertionError|exit code [1-9])/iu;
/** A path with a folder and a file extension, or a bare file name with a known extension. */
const FILE_PATH =
  /(?:[\w@.-]+\/)+[\w.-]+\.[a-z0-9]{1,6}\b|\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|py|go|rs|java|kt|swift|rb|php|cs|vue|svelte|yml|yaml|toml|sql|html)\b/giu;
const PACKAGE_ROOT = /\b(?:packages|apps|libs|services|crates|modules)\/([\w@.-]+)/giu;

/** The ticket type: the one set on the ticket, else the board's detection from the title and the text. */
export function autopilotTicketType(ticket: Pick<AutopilotTicketInput, "type" | "title" | "body">): BoardTicketType | null {
  return ticket.type ?? detectBoardTicketType({ title: ticket.title, body: ticket.body });
}

/** Whether a Bug ticket carries a failing case that a test can reproduce first. */
export function hasFailingCase(title: string, body: string): boolean {
  return FAILING_CASE.test(`${title}\n${body}`);
}

/** The size of the change from the files and packages the ticket names and the words it uses. */
export function estimateChangeSize(
  title: string,
  body: string,
): { size: RavenAutopilotChangeSize; files: number | null } {
  const text = `${title}\n${body}`;
  const files = new Set([...text.matchAll(FILE_PATH)].map((match) => match[0].toLowerCase()));
  const packages = new Set([...text.matchAll(PACKAGE_ROOT)].map((match) => (match[1] ?? "").toLowerCase()));
  const words = text.split(/\s+/u).filter(Boolean).length;
  const count = files.size > 0 ? files.size : null;
  if (files.size >= 4 || packages.size >= 2 || LARGE_WORDS.test(text)) return { size: "large", files: count };
  if (files.size <= 1 && words <= 80) return { size: "small", files: count };
  return { size: "medium", files: count };
}

const SMALL_MODEL = /(haiku|mini|nano|flash|lite|small|tiny|fast)/iu;
const STRONG_MODEL = /(opus|ultra|max|large|(^|[-_.\s])pro($|[-_.\s]))/iu;

/** The class of a model from its id and name. Unknown names are `standard`. */
export function autopilotModelTier(option: Pick<AgentModelOption, "id" | "name">): RavenAutopilotModelTier {
  const text = `${option.id} ${option.name}`;
  if (SMALL_MODEL.test(text)) return "small";
  if (STRONG_MODEL.test(text)) return "strong";
  return "standard";
}

/** The order to try classes in when the wanted class has no model. */
const TIER_ORDER: Record<RavenAutopilotModelTier, RavenAutopilotModelTier[]> = {
  strong: ["strong", "standard", "small"],
  standard: ["standard", "strong", "small"],
  small: ["small", "standard", "strong"],
};

/** The class of each role of a template for a decision class. A verifier gets a second model when one exists. */
function roleTiers(templateId: string, tier: RavenAutopilotModelTier): Record<string, RavenAutopilotModelTier> {
  if (templateId === RAVEN_STACK_TEAM_TEMPLATE_ID) {
    return tier === "strong"
      ? { architect: "strong", builder: "strong", reviewer: "standard", quality: "standard" }
      : { architect: "standard", builder: "standard", reviewer: "strong", quality: "standard" };
  }
  return tier === "small" ? { builder: "small", reviewer: "standard" } : { builder: "standard", reviewer: "strong" };
}

function pickModel(
  candidates: readonly AgentModelOption[],
  tier: RavenAutopilotModelTier,
  avoid: string | null,
): AgentModelOption | null {
  for (const wanted of TIER_ORDER[tier]) {
    const found = candidates.find((option) => autopilotModelTier(option) === wanted && option.id !== avoid);
    if (found) return found;
  }
  return candidates.find((option) => option.id !== avoid) ?? candidates[0] ?? null;
}

/**
 * The model of each role, from the preferred provider's models when it lists any. A verifier is put on a
 * model other than the Builder's when one exists. The fallback is a strong model other than the Builder's,
 * so a failed round can switch without asking the user; none when no other model exists.
 */
export function autopilotModels(
  templateId: string,
  tier: RavenAutopilotModelTier,
  models: readonly AgentModelOption[],
  preferredProvider: AgentProviderId,
): Record<string, string> {
  const own = models.filter((option) => option.provider === preferredProvider);
  const candidates = own.length > 0 ? own : models;
  const tiers = roleTiers(templateId, tier);
  const chosen: Record<string, string> = {};
  const builder = pickModel(candidates, tiers.builder ?? "standard", null);
  if (builder) chosen.builder = builder.id;
  for (const [roleId, roleTier] of Object.entries(tiers)) {
    if (roleId === "builder") continue;
    const verifier = roleId === "reviewer" || roleId === "quality";
    const option = pickModel(candidates, roleTier, verifier ? (builder?.id ?? null) : null);
    if (option) chosen[roleId] = option.id;
  }
  const fallback = pickModel(candidates, "strong", builder?.id ?? null);
  if (fallback && fallback.id !== builder?.id) chosen[FALLBACK_KEY] = fallback.id;
  return chosen;
}

interface StackChoice {
  stack: RavenAutopilotStack;
  templateId: string;
  playbook: string | null;
  tier: RavenAutopilotModelTier;
  reasonCode: RavenAutopilotReasonCode;
}

/** The table of the issue: type and size give the stack, the template and the model class. */
function tableChoice(type: BoardTicketType, size: RavenAutopilotChangeSize, failingCase: boolean): StackChoice {
  const raven = (templateId: string, tier: RavenAutopilotModelTier, reasonCode: RavenAutopilotReasonCode) => ({
    stack: "raven-stack" as const,
    templateId,
    playbook: null,
    tier,
    reasonCode,
  });
  switch (type) {
    case "feature":
      return size === "small"
        ? raven(RAVEN_STACK_LITE_TEMPLATE_ID, "standard", "feature-small")
        : raven(RAVEN_STACK_TEAM_TEMPLATE_ID, "strong", "feature-large");
    case "bug":
      return failingCase
        ? raven(RAVEN_STACK_LITE_TEMPLATE_ID, "standard", "bug-failing-case")
        : raven(RAVEN_STACK_TEAM_TEMPLATE_ID, "strong", "bug-investigate");
    case "chore":
      return raven(RAVEN_STACK_LITE_TEMPLATE_ID, "small", "chore-small");
  }
}

/**
 * Autopilot's decision for a ticket. Null when the ticket has no type and the text gives none: the engine
 * then leaves the ticket in Backlog with a note.
 */
export function decideAutopilot(input: AutopilotDecisionInput): AutopilotChoice | null {
  const { ticket, settings } = input;
  const type = autopilotTicketType(ticket);
  if (type === null) return null;
  const { size, files } = estimateChangeSize(ticket.title, ticket.body);
  const table = tableChoice(type, size, hasFailingCase(ticket.title, ticket.body));
  const override = ravenAutopilotOverride({ overrides: settings.overrides, ...OVERRIDE_ONLY }, type);
  let choice: StackChoice;
  if (override) {
    const preset = ravenAutopilotPreset(override.preset);
    choice = {
      stack: preset.stack,
      // A stack with no Raven team template (pstack) runs the two roles of Autopilot lite.
      templateId: preset.templateId ?? RAVEN_STACK_LITE_TEMPLATE_ID,
      playbook: preset.playbook,
      tier: table.tier,
      reasonCode: "override",
    };
  } else if (!settings.autoStack) {
    choice = {
      stack: "raven-stack",
      templateId: RAVEN_STACK_TEAM_TEMPLATE_ID,
      playbook: null,
      tier: "standard",
      reasonCode: "manual-stack",
    };
  } else {
    choice = table;
  }
  const models = {
    ...autopilotModels(choice.templateId, choice.tier, input.models, input.preferredProvider),
    ...(override?.models ?? {}),
  };
  const decision: RavenAutopilotDecision = {
    ticketId: ticket.id,
    ticketTitle: ticket.title.slice(0, 300),
    ticketType: type,
    stack: choice.stack,
    templateId: choice.templateId,
    playbook: choice.playbook,
    // The team start replaces these with the roles of the checked plan.
    roles: Object.entries(models)
      .filter(([roleId]) => roleId !== FALLBACK_KEY)
      .map(([roleId, model]) => ({ roleId, label: roleId, model })),
    reason: input.reasonText(choice.reasonCode, files, type),
    source: override ? "override" : "auto",
    decidedAt: input.now,
    reasonCode: choice.reasonCode,
    changeSize: size,
    files,
    repo: ticket.repo,
    modelTier: choice.tier,
    switches: [],
  };
  return { decision, models };
}

/** `ravenAutopilotOverride` reads only `overrides`; the rest of the settings does not change its answer. */
const OVERRIDE_ONLY = {
  enabled: false,
  autoStack: true,
  pickUp: { column: "backlog", assignee: "raven-or-unassigned" },
  ticketsAtOnce: 2,
  roundCap: 3,
  pauseOnUsageLimit: true,
  reviewerMerge: { enabled: false, types: { feature: false, bug: false, chore: false }, method: "squash" },
  notifyOnMerge: true,
} as const satisfies Omit<RavenAutopilotSettings, "overrides">;
