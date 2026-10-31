import type { AgentTask } from "./ipc-agent-tasks";
import { isBoundedString, isFiniteNumber, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import type { RavenTeamJob, RavenTeamRoleRun } from "./ipc-raven-team";
import { isDynamicRecord, isOneOf } from "./runtime-values";

/**
 * The Tickets board. Every piece of agent work is a board ticket in one of five columns. An agent moves
 * its own tickets; the person can drag a ticket to override. When a ticket system is connected and the
 * board names a sync target, a ticket links one external issue. Otherwise the ticket lives on this
 * computer only.
 */
export const BOARD_TICKET_STATUSES = ["backlog", "queued", "running", "needs_review", "done"] as const;
export type BoardTicketStatus = (typeof BOARD_TICKET_STATUSES)[number];

export const BOARD_TICKET_PROVIDERS = ["github", "jira", "linear"] as const;
export type BoardTicketProvider = (typeof BOARD_TICKET_PROVIDERS)[number];

/**
 * The kind of work of a ticket. Null on a ticket means "not set yet": the detection found no sign, and the
 * person or Autopilot sets it later.
 */
export const BOARD_TICKET_TYPES = ["feature", "bug", "chore"] as const;
export type BoardTicketType = (typeof BOARD_TICKET_TYPES)[number];

/**
 * Who set the type of a ticket. `detected`: the labels, the title or the text, when the ticket was created
 * or synced. `user`: the person chose it, and detection never changes it again. `agent`: an agent set it.
 */
export const BOARD_TICKET_TYPE_SOURCES = ["detected", "user", "agent"] as const;
export type BoardTicketTypeSource = (typeof BOARD_TICKET_TYPE_SOURCES)[number];

export const BOARD_TICKET_EVENT_KINDS = [
  "created",
  "moved",
  "assigned",
  "comment",
  "progress",
  "type_changed",
  "phase",
  "verdict",
] as const;
export type BoardTicketEventKind = (typeof BOARD_TICKET_EVENT_KINDS)[number];

/**
 * The step of the work that the ticket's agent reports (ticket 237). Reproduce is only for bugs. Done here
 * is the agent's own end of the work; the Done column stays the person's approval.
 */
export const BOARD_TICKET_PHASES = [
  "take",
  "triage",
  "reproduce",
  "implement",
  "verify",
  "review",
  "merge",
  "done",
] as const;
export type BoardTicketPhase = (typeof BOARD_TICKET_PHASES)[number];

/** The phases that the ticket detail shows, in order. Only a bug ticket has Reproduce. */
export function boardTicketPhaseSteps(type: BoardTicketType | null): BoardTicketPhase[] {
  return BOARD_TICKET_PHASES.filter((phase) => phase !== "reproduce" || type === "bug");
}

/** A reviewer's verdict on a ticket's pull request (ticket 239). */
export const BOARD_TICKET_VERDICTS = ["PASS", "PASS+NOTES", "FAIL"] as const;
export type BoardTicketVerdict = (typeof BOARD_TICKET_VERDICTS)[number];

/** One saved verdict, read from a `verdict` event. */
export interface BoardTicketReviewVerdict {
  verdict: BoardTicketVerdict;
  headSha: string;
  notes: string;
  reviewerId: string;
  at: string;
}

/** The verdicts of a ticket, oldest first, from its events. An event that does not decode is skipped. */
export function boardTicketVerdicts(events: readonly BoardTicketEvent[]): BoardTicketReviewVerdict[] {
  const verdicts: BoardTicketReviewVerdict[] = [];
  for (const event of events) {
    if (event.kind !== "verdict" || !event.text) continue;
    try {
      const value = JSON.parse(event.text);
      if (
        isDynamicRecord(value) &&
        BOARD_TICKET_VERDICTS.some((verdict) => verdict === value.verdict) &&
        typeof value.headSha === "string" &&
        typeof value.notes === "string" &&
        typeof value.reviewerId === "string"
      ) {
        const verdict = BOARD_TICKET_VERDICTS.find((item) => item === value.verdict) ?? "FAIL";
        verdicts.push({
          verdict,
          headSha: value.headSha,
          notes: value.notes,
          reviewerId: value.reviewerId,
          at: event.createdAt,
        });
      }
    } catch {
      // A broken verdict text never counts.
    }
  }
  return verdicts;
}

/**
 * The merge rule of a single ticket thread: the newest verdict on the current head commit is PASS or
 * PASS+NOTES, and no FAIL was given on that head. A verdict on an older commit never counts.
 */
export function boardTicketMayMerge(verdicts: readonly BoardTicketReviewVerdict[], head: string | null): boolean {
  if (!head) return false;
  const onHead = verdicts.filter((verdict) => verdict.headSha === head);
  const last = onHead.at(-1);
  return last !== undefined && last.verdict !== "FAIL" && onHead.every((verdict) => verdict.verdict !== "FAIL");
}

export const BOARD_TICKET_ACTORS = ["user", "agent", "sync"] as const;
export type BoardTicketActor = (typeof BOARD_TICKET_ACTORS)[number];

export const BOARD_TICKET_TITLE_LIMIT = 200;
export const BOARD_TICKET_BODY_LIMIT = 20_000;
export const BOARD_TICKET_PROGRESS_LIMIT = 500;
export const BOARD_TICKET_ERROR_LIMIT = 2_000;
export const BOARD_TICKET_COMMENT_LIMIT = 4_000;
export const BOARD_TICKET_EXTERNAL_KEY_LIMIT = 300;
export const BOARD_TICKET_URL_LIMIT = 2_000;
/** The most tickets that one board list returns. */
export const BOARD_TICKET_LIST_LIMIT = 2_000;
/** The most events that one ticket's activity returns, newest kept. */
export const BOARD_TICKET_EVENT_LIMIT = 500;

/** The linked issue of a ticket system. */
export interface BoardTicketExternal {
  provider: BoardTicketProvider;
  /** The stable ID of the issue, such as `owner/repo#12` for GitHub or `PH-88` for Linear. */
  key: string;
  url: string;
}

export interface BoardTicket {
  id: string;
  title: string;
  body: string;
  status: BoardTicketStatus;
  /** Feature, Bug or Chore. Null: not set yet. */
  type: BoardTicketType | null;
  /** Who set the type. Null while the type was never set. */
  typeSource: BoardTicketTypeSource | null;
  /** The assigned agent. Null: the ticket is unassigned. */
  agentId: string | null;
  /** The order in the column. A lower value shows higher. */
  order: number;
  /** The work thread (agent task) that does the ticket's work. */
  taskId: string | null;
  /** The conversation thread of that work thread. */
  threadId: string | null;
  /** The Raven Stack team job and role that the ticket belongs to. */
  teamJobId: string | null;
  teamRoleId: string | null;
  external: BoardTicketExternal | null;
  /** The live progress line, such as "Checked 41 of 112 links". */
  progress: string | null;
  /** The last failure line, such as "The last turn failed". */
  error: string | null;
  /** The work phase that the agent last reported. Absent: none reported yet. */
  phase?: BoardTicketPhase;
  /** The git worktree and branch of the ticket's work thread. Absent: it shares the agent workspace. */
  worktree?: BoardTicketWorktree;
  /** When the ticket last entered each column. The stepper shows these. */
  statusTimes: Partial<Record<BoardTicketStatus, string>>;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** The worktree that a ticket's work thread owns: its folder and its branch. */
export interface BoardTicketWorktree {
  path: string;
  branch: string;
}

/** What a piece of ticket evidence is: an image, a screen recording, test output or a diff. */
export const BOARD_TICKET_EVIDENCE_KINDS = ["screenshot", "recording", "test_output", "diff"] as const;
export type BoardTicketEvidenceKind = (typeof BOARD_TICKET_EVIDENCE_KINDS)[number];
/** When it was taken: before the change, after it, or for the review. */
export const BOARD_TICKET_EVIDENCE_PHASES = ["before", "after", "review"] as const;
export type BoardTicketEvidencePhase = (typeof BOARD_TICKET_EVIDENCE_PHASES)[number];
/** The longest caption of a piece of evidence. */
export const BOARD_TICKET_EVIDENCE_CAPTION_LIMIT = 500;
/** The longest test output or diff that a ticket keeps, in characters. */
export const BOARD_TICKET_EVIDENCE_TEXT_LIMIT = 65_536;
/** The largest screenshot, in bytes. */
export const BOARD_TICKET_EVIDENCE_IMAGE_BYTES = 10 * 1024 * 1024;
/** The largest screen recording, in bytes. */
export const BOARD_TICKET_EVIDENCE_RECORDING_BYTES = 50 * 1024 * 1024;
/** The most pieces of evidence that one ticket keeps. */
export const BOARD_TICKET_EVIDENCE_LIMIT = 200;

/**
 * One piece of a ticket's evidence (#236, #264). A screenshot or a recording is a file in the app data;
 * test output and a diff are text. The ticket detail shows them in a Before / After / Review strip.
 */
export interface BoardTicketEvidence {
  id: string;
  ticketId: string;
  kind: BoardTicketEvidenceKind;
  phase: BoardTicketEvidencePhase;
  actor: BoardTicketActor;
  caption: string | null;
  /** The name of the attached file, such as `before.png`. Null for text given without a file. */
  fileName: string | null;
  /** The file type of a screenshot or a recording, such as `image/png`. Null for text. */
  mime: string | null;
  sizeBytes: number;
  /** The test output or the diff. Null for a screenshot or a recording. */
  text: string | null;
  createdAt: string;
}

/** A person's attachment: main asks for the file, so the renderer never names a path. */
export interface AttachBoardTicketEvidenceInput {
  ticketId: string;
  phase: BoardTicketEvidencePhase;
  caption?: string;
}

export function isBoardTicketEvidence(value: unknown): value is BoardTicketEvidence {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.ticketId) &&
    isOneOf(BOARD_TICKET_EVIDENCE_KINDS, value.kind) &&
    isOneOf(BOARD_TICKET_EVIDENCE_PHASES, value.phase) &&
    isOneOf(BOARD_TICKET_ACTORS, value.actor) &&
    isNullableBoundedString(value.caption, BOARD_TICKET_EVIDENCE_CAPTION_LIMIT) &&
    isNullableBoundedString(value.fileName, 300) &&
    isNullableBoundedString(value.mime, 100) &&
    isFiniteNumber(value.sizeBytes) &&
    isNullableBoundedString(value.text, BOARD_TICKET_EVIDENCE_TEXT_LIMIT) &&
    isBoundedString(value.createdAt, 160)
  );
}

export function isBoardTicketEvidenceList(value: unknown): value is BoardTicketEvidence[] {
  return Array.isArray(value) && value.length <= BOARD_TICKET_EVIDENCE_LIMIT && value.every(isBoardTicketEvidence);
}

/** One entry of a ticket's activity. */
export interface BoardTicketEvent {
  id: string;
  ticketId: string;
  kind: BoardTicketEventKind;
  actor: BoardTicketActor;
  fromStatus: BoardTicketStatus | null;
  toStatus: BoardTicketStatus | null;
  /** The comment, the progress line or the assigned agent. For `type_changed`, the new type, or null when it was cleared. */
  text: string | null;
  createdAt: string;
}

/** The change event: the IDs of the tickets that changed or were deleted. The view reads the list again. */
export interface BoardTicketsChanged {
  ticketIds: string[];
}

/** The longest repository or project name that a sync target takes. */
export const BOARD_TICKET_SYNC_PROJECT_LIMIT = 300;
/** The most repositories or projects that one list returns. */
const BOARD_TICKET_SYNC_PROJECT_LIST_LIMIT = 1_000;

/** The repository or project that the board syncs with, such as `owner/repo` for GitHub. */
export interface BoardTicketSyncTarget {
  provider: BoardTicketProvider;
  project: string;
}

/**
 * The sync of the board with a ticket system. `providers` are the systems that are connected on this
 * computer and that the board can sync with. Empty: the board does not sync, and the page shows no sync
 * control. `target` is null when no target is chosen, or when its system is not connected now.
 */
export interface BoardTicketSyncState {
  providers: BoardTicketProvider[];
  target: BoardTicketSyncTarget | null;
  /** When the last import ended. Null before the first one. */
  lastSyncedAt: string | null;
  /** The last import failure, as a sentence. Null after an import that worked. */
  error: string | null;
}

export interface CreateBoardTicketInput {
  title: string;
  body?: string;
  /** The default is `backlog`. */
  status?: BoardTicketStatus;
  agentId?: string | null;
  /** The type that the person chose. Absent: the board detects it from the title and the text. */
  type?: BoardTicketType | null;
}

/** Changes the fields that are present. `null` clears a nullable field. */
export interface UpdateBoardTicketInput {
  ticketId: string;
  title?: string;
  body?: string;
  agentId?: string | null;
  /** The person's choice of type. It wins over detection from then on; `null` clears it. */
  type?: BoardTicketType | null;
  progress?: string | null;
  error?: string | null;
}

/** Moves a ticket to a column. With `beforeTicketId`, it goes above that ticket; without, to the end. */
export interface MoveBoardTicketInput {
  ticketId: string;
  status: BoardTicketStatus;
  beforeTicketId?: string | null;
}

export interface CommentBoardTicketInput {
  ticketId: string;
  text: string;
}

/**
 * Starts the work of a ticket: one work thread of the agent, linked to the ticket, with the title and
 * the body as its first message. With `ticketId`, the ticket exists already ("Start now" on a backlog
 * ticket). Without it, `title` is required and the start also creates the ticket.
 */
export interface StartBoardTicketInput {
  agentId: string;
  ticketId?: string;
  title?: string;
  body?: string;
  /**
   * Request changes on a ticket in review (ticket 248): the text goes to the ticket's own run, or starts
   * a new run of its agent when that run is gone, and the ticket goes back to Running.
   */
  changes?: string;
}

/** Why the work of a ticket went back to Backlog: its last turn failed, or the person stopped it. */
export type BoardTicketWorkFailure = "failed" | "stopped";

/** The column that the work thread of a ticket asks for, and why it went back when it did. */
export interface BoardTicketWorkStep {
  status: BoardTicketStatus;
  failure: BoardTicketWorkFailure | null;
}

/**
 * The column that a ticket's work thread asks for: Queued while its message waits for a slot of the
 * agent, Running while a turn runs, Needs review while the turn asks the person a question or after a
 * turn that completed, and Backlog after a turn that failed or that the person stopped. Null: the
 * thread asks for no change (it is closed, or no turn of it ended yet). Done is the person's approval,
 * so a thread never asks for it. The desktop and the preview move tickets with the same rule.
 */
export function boardTicketWorkStep(
  task: Pick<AgentTask, "state" | "outcome" | "question">,
): BoardTicketWorkStep | null {
  if (task.state === "closed") return null;
  if (task.question) return { status: "needs_review", failure: null };
  if (task.state === "running") return { status: "running", failure: null };
  if (task.state === "queued") return { status: "queued", failure: null };
  switch (task.outcome) {
    case "completed":
      return { status: "needs_review", failure: null };
    case "failed":
      return { status: "backlog", failure: "failed" };
    case "interrupted":
      return { status: "backlog", failure: "stopped" };
    default:
      return null;
  }
}

/** Why a team job took its tickets out of the work: the person stopped it, or it ended not done. */
export type BoardTicketTeamFailure = "stopped" | "not-done" | "stalled";

/** The column that a Raven Stack team job asks for one of its tickets, and the failure line it gives. */
export interface BoardTicketTeamStep {
  status: BoardTicketStatus;
  failure: BoardTicketTeamFailure | null;
}

/**
 * The column of a team job's own ticket: Queued while the job waits for a slot of its role agents,
 * Running while it runs, Needs review while it waits for the person or after it passes (ticket 250), Done
 * once its pull request is merged, and back to
 * Backlog with a failure line when it is stopped or ends not done.
 *
 * An Autopilot job (one with a decision) works on a ticket that the person reviews: a pass leaves the pull
 * request in Needs review, and a stop also leaves the ticket in Needs review with its failure line, so
 * Autopilot does not take it again. Only a job that runs again takes the ticket out of Needs review.
 * When the Reviewer merged the pull request (#198), the ticket moves to Done ("Merged by Reviewer").
 */
export function boardTicketTeamJobStep(
  job: Pick<RavenTeamJob, "state" | "queued" | "decision"> & { question?: RavenTeamJob["question"] },
): BoardTicketTeamStep {
  const autopilot = job.decision !== undefined && job.decision !== null;
  switch (job.state) {
    case "done":
      // ticket 250: a finished job waits for the person's review and merge; only a merge reaches Done.
      return { status: job.decision?.merge?.state === "merged" ? "done" : "needs_review", failure: null };
    case "not-done":
      return { status: "backlog", failure: "not-done" };
    case "stopped":
      return { status: autopilot ? "needs_review" : "backlog", failure: "stopped" };
    case "waiting-user":
      // ticket 249: a stalled role shows its reason on the ticket, never a silent Working.
      return { status: "needs_review", failure: job.question?.kind === "stalled" ? "stalled" : null };
    default:
      return { status: job.queued ? "queued" : "running", failure: null };
  }
}

/**
 * The column that a team job asks for the ticket of one of its roles. A role with a work thread asks
 * for nothing (null): its thread moves the ticket with `boardTicketWorkStep`, until the job passes and
 * every role ticket goes to Done. A role with no thread yet waits in Queued while the job is queued and
 * in Backlog until the job reaches it. The desktop and the preview move role tickets with this rule.
 */
export function boardTicketTeamRoleStep(
  job: Pick<RavenTeamJob, "state" | "queued">,
  role: Pick<RavenTeamRoleRun, "taskId" | "state">,
): BoardTicketTeamStep | null {
  if (job.state === "done") return { status: "done", failure: null };
  if (role.taskId !== null) return null;
  if (job.state === "stopped") return { status: "backlog", failure: "stopped" };
  if (job.state === "not-done") return { status: "backlog", failure: "not-done" };
  if (job.queued) return { status: "queued", failure: null };
  if (role.state === "working") return { status: "running", failure: null };
  if (role.state === "blocked") return { status: "needs_review", failure: null };
  return { status: "backlog", failure: null };
}

const TYPE_LABELS: Record<BoardTicketType, readonly string[]> = {
  bug: ["bug", "bugs", "defect", "regression", "crash", "fix", "bugfix", "hotfix", "incident", "type: bug", "kind/bug"],
  feature: ["feature", "features", "feat", "enhancement", "story", "new feature", "feature request", "improvement"],
  chore: [
    "chore",
    "maintenance",
    "refactor",
    "refactoring",
    "tech debt",
    "technical debt",
    "dependencies",
    "deps",
    "ci",
    "build",
    "docs",
    "documentation",
    "cleanup",
    "tooling",
  ],
};

const TITLE_PREFIX: readonly [RegExp, BoardTicketType][] = [
  [/^(?:\[)?(?:feat|feature)(?:\(.*?\))?!?(?:\])?\s*[:-]/iu, "feature"],
  [/^(?:\[)?(?:fix|bug|bugfix|hotfix)(?:\(.*?\))?!?(?:\])?\s*[:-]/iu, "bug"],
  [/^(?:\[)?(?:chore|refactor|docs|ci|build|test|tests|perf|style|deps)(?:\(.*?\))?!?(?:\])?\s*[:-]/iu, "chore"],
];

/** The first word of the title, as an order: "Add dark mode", "Fix the redirect", "Bump Electron". */
const TITLE_START: readonly [RegExp, BoardTicketType][] = [
  [/^(?:fix|repair|resolve|debug|investigate)\b/iu, "bug"],
  [/^(?:bump|upgrade|refactor|clean ?up|rename|remove|delete|migrate|document|audit|update|tidy|lint)\b/iu, "chore"],
  [/^(?:add|implement|support|introduce|allow|enable|create|build|design|new|let)\b/iu, "feature"],
];

/** Words anywhere in the title. A bug word wins over a chore word. */
const TITLE_WORDS: readonly [RegExp, BoardTicketType][] = [
  [
    /\b(?:bug|crash(?:es|ed|ing)?|broken|regression|fails?|failing|failed|not working|doesn'?t work|incorrect)\b/iu,
    "bug",
  ],
  [/\b(?:dependencies|tech debt|clean ?up|chore|refactor)\b/iu, "chore"],
];

const BODY_BUG_SIGNS = /\b(?:steps to reproduce|expected behaviou?r|actual behaviou?r|stack ?trace|repro steps)\b/iu;

/** The type that one label names, such as `bug`, `type: feature` or `kind/chore`, or null. */
function labelType(label: string): BoardTicketType | null {
  const clean = label.trim().toLowerCase();
  const bare = clean.replace(/^(?:type|kind|issue type|t)\s*[:/]\s*/u, "");
  for (const type of BOARD_TICKET_TYPES) {
    if (TYPE_LABELS[type].includes(clean) || TYPE_LABELS[type].includes(bare)) return type;
  }
  return null;
}

/**
 * The type of a ticket from what its ticket system and its text say: a label first (GitHub, Jira, Linear),
 * then a prefix of the title such as `fix:`, then its first word and its other words, then signs of a bug
 * report in the text. Null when nothing says. The desktop and the preview detect with the same rule. The
 * words are English: a title in another language gets its type from a label or from the person.
 */
export function detectBoardTicketType(input: {
  labels?: readonly string[];
  title: string;
  body?: string;
}): BoardTicketType | null {
  for (const label of input.labels ?? []) {
    const type = labelType(label);
    if (type) return type;
  }
  const title = input.title.trim();
  for (const rules of [TITLE_PREFIX, TITLE_START, TITLE_WORDS]) {
    for (const [pattern, type] of rules) if (pattern.test(title)) return type;
  }
  if (input.body && BODY_BUG_SIGNS.test(input.body)) return "bug";
  return null;
}

export function isBoardTicketType(value: unknown): value is BoardTicketType {
  return isOneOf(BOARD_TICKET_TYPES, value);
}

export function isBoardTicketStatus(value: unknown): value is BoardTicketStatus {
  return isOneOf(BOARD_TICKET_STATUSES, value);
}

export function isBoardTicketProvider(value: unknown): value is BoardTicketProvider {
  return isOneOf(BOARD_TICKET_PROVIDERS, value);
}

function isBoardTicketSyncTarget(value: unknown): value is BoardTicketSyncTarget {
  return (
    isDynamicRecord(value) &&
    isBoardTicketProvider(value.provider) &&
    isBoundedString(value.project, BOARD_TICKET_SYNC_PROJECT_LIMIT) &&
    value.project.length > 0
  );
}

export function isBoardTicketSyncState(value: unknown): value is BoardTicketSyncState {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.providers) &&
    value.providers.length <= BOARD_TICKET_PROVIDERS.length &&
    value.providers.every(isBoardTicketProvider) &&
    (value.target === null || isBoardTicketSyncTarget(value.target)) &&
    isNullableBoundedString(value.lastSyncedAt, 160) &&
    isNullableBoundedString(value.error, BOARD_TICKET_ERROR_LIMIT)
  );
}

export function isBoardTicketSyncProjects(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= BOARD_TICKET_SYNC_PROJECT_LIST_LIMIT &&
    value.every((project) => isBoundedString(project, BOARD_TICKET_SYNC_PROJECT_LIMIT) && project.length > 0)
  );
}

function isBoardTicketExternal(value: unknown): value is BoardTicketExternal {
  return (
    isDynamicRecord(value) &&
    isOneOf(BOARD_TICKET_PROVIDERS, value.provider) &&
    isBoundedString(value.key, BOARD_TICKET_EXTERNAL_KEY_LIMIT) &&
    value.key.length > 0 &&
    isBoundedString(value.url, BOARD_TICKET_URL_LIMIT)
  );
}

function isStatusTimes(value: unknown): value is Partial<Record<BoardTicketStatus, string>> {
  return (
    isDynamicRecord(value) &&
    Object.entries(value).every(([status, time]) => isBoardTicketStatus(status) && isBoundedString(time, 160))
  );
}

function isBoardTicketWorktree(value: unknown): value is BoardTicketWorktree {
  return isDynamicRecord(value) && isBoundedString(value.path, 4096) && isBoundedString(value.branch, 300);
}

function isNullableIdentifier(value: unknown): value is string | null {
  return value === null || isIdentifier(value);
}

export function isBoardTicket(value: unknown): value is BoardTicket {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.title, BOARD_TICKET_TITLE_LIMIT) &&
    isBoundedString(value.body, BOARD_TICKET_BODY_LIMIT) &&
    isBoardTicketStatus(value.status) &&
    (value.type === null || isBoardTicketType(value.type)) &&
    (value.typeSource === null || isOneOf(BOARD_TICKET_TYPE_SOURCES, value.typeSource)) &&
    (value.phase === undefined || isOneOf(BOARD_TICKET_PHASES, value.phase)) &&
    isNullableIdentifier(value.agentId) &&
    isFiniteNumber(value.order) &&
    isNullableIdentifier(value.taskId) &&
    isNullableIdentifier(value.threadId) &&
    isNullableIdentifier(value.teamJobId) &&
    isNullableIdentifier(value.teamRoleId) &&
    (value.external === null || isBoardTicketExternal(value.external)) &&
    isNullableBoundedString(value.progress, BOARD_TICKET_PROGRESS_LIMIT) &&
    isNullableBoundedString(value.error, BOARD_TICKET_ERROR_LIMIT) &&
    (value.worktree === undefined || isBoardTicketWorktree(value.worktree)) &&
    isStatusTimes(value.statusTimes) &&
    isBoundedString(value.statusChangedAt, 160) &&
    isBoundedString(value.createdAt, 160) &&
    isBoundedString(value.updatedAt, 160)
  );
}

export function isBoardTicketList(value: unknown): value is BoardTicket[] {
  return Array.isArray(value) && value.length <= BOARD_TICKET_LIST_LIMIT && value.every(isBoardTicket);
}

export function isBoardTicketEvent(value: unknown): value is BoardTicketEvent {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.ticketId) &&
    isOneOf(BOARD_TICKET_EVENT_KINDS, value.kind) &&
    isOneOf(BOARD_TICKET_ACTORS, value.actor) &&
    (value.fromStatus === null || isBoardTicketStatus(value.fromStatus)) &&
    (value.toStatus === null || isBoardTicketStatus(value.toStatus)) &&
    isNullableBoundedString(value.text, BOARD_TICKET_COMMENT_LIMIT) &&
    isBoundedString(value.createdAt, 160)
  );
}

export function isBoardTicketEventList(value: unknown): value is BoardTicketEvent[] {
  return Array.isArray(value) && value.length <= BOARD_TICKET_EVENT_LIMIT && value.every(isBoardTicketEvent);
}

export function isBoardTicketsChanged(value: unknown): value is BoardTicketsChanged {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.ticketIds) &&
    value.ticketIds.length <= BOARD_TICKET_LIST_LIMIT &&
    value.ticketIds.every(isIdentifier)
  );
}

/**
 * The agent of a ticket at the time of each event (ticket 247), oldest event first: the last `assigned` event
 * at or before it. A reassign then never credits an earlier run to the new agent.
 */
export function boardTicketEventAgents(events: readonly BoardTicketEvent[]): Map<string, string | null> {
  const agents = new Map<string, string | null>();
  let agentId: string | null = null;
  for (const event of events) {
    if (event.kind === "assigned") agentId = event.text;
    agents.set(event.id, agentId);
  }
  return agents;
}
