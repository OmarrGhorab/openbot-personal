import type { BoardTicketProvider } from "./ipc-board-tickets";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import type { RavenTeamJob } from "./ipc-raven-team";
import { isDynamicRecord } from "./runtime-values";

/**
 * Chat: an agent takes a ticket from a message (#200). The person writes "take this ticket in jira fix it"
 * with a link or a key. Main reads the message again with `detectTicketTakeRequest` (the renderer only asks),
 * finds or creates the board ticket, and the Autopilot engine starts its job at once. The job's decision
 * names the agent and the thread that asked (`RavenAutopilotChat`), so the chat shows a "Ticket taken" card
 * that follows the job. No database change: the decision is the job's JSON.
 */

/** The longest message that a take request reads. A longer message is cut, not refused. */
export const TICKET_TAKE_TEXT_LIMIT = 20_000;
const KEY_LIMIT = 300;
const URL_LIMIT = 2_000;

/** A ticket that a message names. `provider` is null for a bare key such as `PROJ-482` with no system named. */
export interface TicketTakeReference {
  provider: BoardTicketProvider | null;
  /** `owner/repo#12` for GitHub, `PROJ-482` for Jira, `PH-88` for Linear. */
  key: string;
  /** The issue page, when the message has the link or the key gives it (GitHub). */
  url: string | null;
}

/** The agent and the conversation thread that asked for the ticket. The card shows in that thread. */
export interface RavenAutopilotChat {
  agentId: string;
  threadId: string | null;
  /** The issue key that the message named, such as `PROJ-482`, so the card shows it after a restart. */
  ticketKey?: string | null;
}

export interface TakeRavenTicketInput {
  /** The agent whose chat the message is in. */
  agentId: string;
  /** The message as the person sent it. Main detects the ticket again; the renderer's guess is not trusted. */
  text: string;
}

/**
 * What a take request did.
 * - `taken`: a job works on the ticket. `already` is true when a job of the ticket was there before.
 * - `connect`: the ticket system of the ticket is not connected on this computer. The agent asks the person
 *   to connect it.
 * - `none`: the message names no ticket, or does not ask to take it.
 * - `failed`: the ticket was found or made, but no job started. `reason` is a sentence, without secrets.
 */
export type RavenTicketTakeResult =
  | {
      outcome: "taken";
      jobId: string;
      ticketId: string;
      key: string;
      provider: BoardTicketProvider | null;
      already: boolean;
    }
  | { outcome: "connect"; key: string; provider: BoardTicketProvider }
  /** A ticket of this board, named by its title: it is now linked to the chat's thread, or already ran. */
  | { outcome: "linked"; ticketId: string; already: boolean }
  | { outcome: "none" }
  | { outcome: "failed"; key: string; reason: string };

/** Words that ask an agent to take the work: "take", "fix", "work on" and so on, in English and Arabic. */
const TAKE_INTENT =
  /(?:^|[^\p{L}])(?:take|grab|fix|work on|pick up|pick it up|handle|resolve|solve|tackle|implement|do|finish|خد|خذ|خُد|صلح|صلّح|اصلح|إصلح|أصلح|اشتغل|حل|نفذ|نفّذ)(?=$|[^\p{L}])/iu;

const GITHUB_URL = /https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d{1,9})\b[^\s)>\]]*/iu;
const GITHUB_SHORT = /(?:^|[^\w/.-])([A-Za-z0-9][\w.-]{0,38})\/([\w.-]{1,100})#(\d{1,9})\b/u;
const JIRA_URL = /https?:\/\/[\w.-]+\/(?:browse\/|[^\s]*[?&]selectedIssue=)([A-Z][A-Z0-9_]{1,19}-\d{1,9})\b[^\s)>\]]*/u;
const LINEAR_URL = /https?:\/\/linear\.app\/[\w.-]+\/issue\/([A-Z][A-Z0-9]{0,9}-\d{1,9})\b[^\s)>\]]*/iu;
const BARE_KEY = /(?:^|[^\w-])([A-Z][A-Z0-9]{1,9}-\d{1,7})(?![\w-])/u;
/** Upper-case words with a number that are not ticket keys. */
const NOT_A_KEY =
  /^(?:UTF|ISO|SHA|RFC|HTTP|HTTPS|TLS|SSL|MD|CVE|GPT|ES|IPV|PEP|ECMA|AES|RSA|COVID|USB|WCAG|X|ARM|AMD)-/u;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?'"]+$/u, "").slice(0, URL_LIMIT);
}

/** The ticket that a message names, or null. A link wins over a key; the first one in the text wins. */
export function detectTicketReference(text: string): TicketTakeReference | null {
  const source = text.slice(0, TICKET_TAKE_TEXT_LIMIT);
  const github = GITHUB_URL.exec(source);
  if (github?.[1] && github[2] && github[3]) {
    return { provider: "github", key: `${github[1]}/${github[2]}#${Number(github[3])}`, url: trimUrl(github[0]) };
  }
  const jira = JIRA_URL.exec(source);
  if (jira?.[1] && !/linear\.app|github\.com/iu.test(jira[0])) {
    return { provider: "jira", key: jira[1], url: trimUrl(jira[0]) };
  }
  const linear = LINEAR_URL.exec(source);
  if (linear?.[1]) return { provider: "linear", key: linear[1].toUpperCase(), url: trimUrl(linear[0]) };
  const short = GITHUB_SHORT.exec(source);
  if (short?.[1] && short[2] && short[3]) {
    const number = Number(short[3]);
    return {
      provider: "github",
      key: `${short[1]}/${short[2]}#${number}`,
      url: `https://github.com/${short[1]}/${short[2]}/issues/${number}`,
    };
  }
  const bare = BARE_KEY.exec(source);
  if (bare?.[1] && !NOT_A_KEY.test(bare[1])) {
    const lower = source.toLowerCase();
    const provider = /\bjira\b|جيرا/u.test(lower) ? "jira" : /\blinear\b|لينير/u.test(lower) ? "linear" : null;
    return { provider, key: bare[1], url: null };
  }
  return null;
}

const TICKET_WORD = /(?:^|[^\p{L}])(?:ticket|tickets|تيكت|التيكت|تذكرة|التذكرة)(?=$|[^\p{L}])/iu;
const QUOTED = /["“”«»]([^"“”«»\n]{2,200}?)["“”«»]/u;

/**
 * A ticket of this board that a message asks to take by its title, such as `take ticket "Bug: sub.js…"`.
 * The message must say "ticket" and ask to take it, and quote the title. A trailing "…" or "..." means the
 * title was cut. Null when the message has none.
 */
export function detectLocalTicketTake(text: string): { title: string; prefix: boolean } | null {
  const source = text.slice(0, TICKET_TAKE_TEXT_LIMIT);
  if (!TICKET_WORD.test(source) || !hasTicketTakeIntent(source)) return null;
  const quoted = QUOTED.exec(source)?.[1]?.trim();
  if (!quoted) return null;
  const cut = /(?:…|\.\.\.)$/u.test(quoted);
  const title = quoted.replace(/(?:…|\.\.\.)$/u, "").trim();
  return title.length >= 2 ? { title, prefix: cut } : null;
}

/** The board ticket whose title the take names: an exact title first, then a cut title's prefix. */
export function matchLocalTicket<T extends { title: string }>(
  tickets: readonly T[],
  take: { title: string; prefix: boolean },
): T | null {
  const wanted = take.title.toLowerCase().replace(/\s+/gu, " ");
  const norm = (title: string) => title.toLowerCase().replace(/\s+/gu, " ").trim();
  const exact = tickets.filter((ticket) => norm(ticket.title) === wanted);
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const starts = tickets.filter((ticket) => norm(ticket.title).startsWith(wanted));
  return starts.length === 1 ? (starts[0] ?? null) : null;
}

/** True when the message asks the agent to take, fix or work on something. */
export function hasTicketTakeIntent(text: string): boolean {
  return TAKE_INTENT.test(text.slice(0, TICKET_TAKE_TEXT_LIMIT));
}

/**
 * The ticket that a message asks the agent to take, or null: the message must name a ticket (a link or a
 * key) and ask to take it. Main runs it on every take request; the renderer runs it only to decide whether
 * to ask main at all.
 */
export function detectTicketTakeRequest(text: string): TicketTakeReference | null {
  if (!hasTicketTakeIntent(text)) return null;
  const reference = detectTicketReference(text);
  return reference && reference.key.length <= KEY_LIMIT ? reference : null;
}

/** True when a board ticket's linked issue is the issue that the reference names. Keys compare without case. */
export function ticketReferenceMatches(
  reference: Pick<TicketTakeReference, "provider" | "key">,
  external: { provider: BoardTicketProvider; key: string } | null,
): boolean {
  if (!external) return false;
  if (reference.provider !== null && reference.provider !== external.provider) return false;
  return external.key.toLowerCase() === reference.key.toLowerCase();
}

/** One step of the live checklist of a "Ticket taken" card. */
export type TicketTakenStepState = "done" | "active" | "pending" | "failed";
export type TicketTakenStepId = "plan" | "build" | "review" | "merge";

export interface TicketTakenStep {
  id: TicketTakenStepId;
  state: TicketTakenStepState;
}

/** The live state of a taken ticket, as the card's pill says it. "Needs you" is the Needs review column. */
export type TicketTakenPhase = "queued" | "working" | "needs-you" | "stopped" | "passed" | "merged" | "not-done";

/** The pill of the card, from the job state. */
export function ticketTakenPhase(job: Pick<RavenTeamJob, "state" | "queued" | "decision">): TicketTakenPhase {
  switch (job.state) {
    case "done":
      return job.decision?.merge?.state === "merged" ? "merged" : "passed";
    case "not-done":
      return "not-done";
    case "stopped":
      return "stopped";
    case "waiting-user":
      return "needs-you";
    default:
      return job.queued ? "queued" : "working";
  }
}

/**
 * The checklist of a "Ticket taken" card, from the job: plan (the Architect, or the Builder's first turn
 * when the job has no Architect), build (the Builder until it reports a commit), review (every verifier
 * passed on the head commit) and merge (only when the Reviewer may merge this ticket). The card reads it
 * again at each job change, so it follows the job live.
 */
export function ticketTakenSteps(
  job: Pick<RavenTeamJob, "state" | "headCommit" | "roles" | "decision">,
  mayMerge: boolean,
): TicketTakenStep[] {
  const architect = job.roles.find((role) => role.roleId === "architect");
  const builder = job.roles.find((role) => role.roleId === "builder");
  const verifiers = job.roles.filter((role) => role.roleId !== "architect" && role.roleId !== "builder");
  const notDone = job.state === "not-done";
  const running = job.state === "running" || job.state === "waiting-user";
  const passed = job.state === "done";
  const planned =
    passed ||
    job.headCommit !== null ||
    (architect ? architect.state !== "working" && architect.state !== "waiting" : builder?.state !== "waiting");
  const built = passed || job.headCommit !== null;
  const reviewed =
    passed ||
    (verifiers.length > 0 && verifiers.every((role) => role.verdict === "PASS" || role.verdict === "PASS+NOTES"));
  const merge = job.decision?.merge ?? null;
  /** The step that works now: active while the job runs, failed when the job ended not done there. */
  const step = (id: TicketTakenStepId, done: boolean, current: boolean): TicketTakenStep => ({
    id,
    state: done ? "done" : current && running ? "active" : current && notDone ? "failed" : "pending",
  });
  const steps = [
    step("plan", planned, !planned),
    step("build", built, planned && !built),
    step("review", reviewed, built && !reviewed),
  ];
  if (mayMerge || merge) {
    steps.push({
      id: "merge",
      state:
        merge?.state === "merged"
          ? "done"
          : merge?.state === "blocked"
            ? "failed"
            : reviewed && passed
              ? "active"
              : "pending",
    });
  }
  return steps;
}

export function isRavenAutopilotChat(value: unknown): value is RavenAutopilotChat {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    (value.ticketKey === undefined || value.ticketKey === null || isBoundedString(value.ticketKey, KEY_LIMIT))
  );
}

const PROVIDERS: readonly unknown[] = ["github", "jira", "linear"];

export function isRavenTicketTakeResult(value: unknown): value is RavenTicketTakeResult {
  if (!isDynamicRecord(value)) return false;
  switch (value.outcome) {
    case "taken":
      return (
        isIdentifier(value.jobId) &&
        isIdentifier(value.ticketId) &&
        isBoundedString(value.key, KEY_LIMIT) &&
        (value.provider === null || PROVIDERS.includes(value.provider)) &&
        typeof value.already === "boolean"
      );
    case "connect":
      return isBoundedString(value.key, KEY_LIMIT) && PROVIDERS.includes(value.provider);
    case "linked":
      return isIdentifier(value.ticketId) && typeof value.already === "boolean";
    case "none":
      return true;
    case "failed":
      return isBoundedString(value.key, KEY_LIMIT) && isBoundedString(value.reason, 2_000);
    default:
      return false;
  }
}
