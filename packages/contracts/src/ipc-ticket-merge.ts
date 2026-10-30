import { isHttpsUrl, isDynamicRecord, isNumber, isString } from "./runtime-values";

/**
 * A ticket that the Reviewer merged (#198). Main turns it into the island, the system notification
 * and the in-app toast (#199).
 *
 * It holds structured facts only: never a diff, a log, a comment or any free text that an agent
 * wrote, so a notification cannot show a secret or a full diff. The ticket title is the one free
 * text; main redacts and shortens it before it shows it anywhere.
 *
 * The field names match `RavenTicketMerged` (#198), so the Reviewer's event can be passed as it is.
 * Main copies only these fields, so any extra field the sender adds never reaches a notification.
 */
export interface TicketMergedEvent {
  /** The board ticket, or null when the merge was not for a board ticket. "View ticket" needs it. */
  ticketId: string | null;
  /** The external key, such as "PROJ-482" or "owner/repo#12". */
  ticketKey: string | null;
  ticketTitle: string;
  /** "owner/repo". */
  repo: string | null;
  prNumber: number | null;
  /** The pull request page. Only an https URL is accepted. "View PR" needs it. */
  prUrl: string | null;
  /** The Reviewer's verdict. A merge happens only after a pass. */
  reviewer: TicketMergeVerdict;
  /** The Quality score out of 10, or null when the team has no Quality role. */
  qualityScore: number | null;
  ci: TicketMergeCiStatus;
  /** ISO time of the merge. */
  mergedAt: string;
}

export type TicketMergeVerdict = "PASS" | "PASS+NOTES";
export type TicketMergeCiStatus = "green" | "none";

/** What the window shows for one merge: the in-app toast and the island. */
export interface TicketMergeNotice {
  /** Main's id for this notice. The island and the toast act on a merge by it. */
  id: string;
  ticketId: string | null;
  ticketKey: string | null;
  /** The redacted, shortened ticket title. */
  title: string;
  prNumber: number | null;
  /** Present only when it is an https URL. */
  prUrl: string | null;
  verdict: TicketMergeVerdict;
  qualityScore: number | null;
  ci: TicketMergeCiStatus;
  mergedAt: string;
}

/** What the user chose on a merge notice: open the ticket, or the pull request. */
export interface TicketMergeOpenRequest {
  noticeId: string;
  target: "ticket" | "pull-request";
}

/** Main sends this to the window to open a merged ticket on the board. */
export interface TicketMergeOpenedEvent {
  notice: TicketMergeNotice;
}

/** The longest ticket title a notification shows. A longer one ends with "…". */
export const TICKET_MERGE_TITLE_LIMIT = 80;
const TITLE_INPUT_LIMIT = 2_000;
const ID_LIMIT = 160;
const URL_LIMIT = 2_048;
const PR_NUMBER_LIMIT = 1_000_000_000;

/** Shortens a title on a character boundary. The caller redacts it first. */
export function shortenTicketMergeTitle(title: string, limit = TICKET_MERGE_TITLE_LIMIT): string {
  const flat = title.replace(/\s+/g, " ").trim();
  const characters = Array.from(flat);
  if (characters.length <= limit) return flat;
  return `${characters
    .slice(0, limit - 1)
    .join("")
    .trimEnd()}…`;
}

export function isTicketMergedEvent(value: unknown): value is TicketMergedEvent {
  return (
    isDynamicRecord(value) &&
    isNullableId(value.ticketId) &&
    isNullableId(value.ticketKey) &&
    isText(value.ticketTitle, TITLE_INPUT_LIMIT) &&
    isNullableId(value.repo) &&
    isNullablePrNumber(value.prNumber) &&
    (value.prUrl === null || (isText(value.prUrl, URL_LIMIT) && isHttpsUrl(value.prUrl))) &&
    isTicketMergeVerdict(value.reviewer) &&
    isNullableQualityScore(value.qualityScore) &&
    isTicketMergeCiStatus(value.ci) &&
    isText(value.mergedAt, 80) &&
    !Number.isNaN(Date.parse(value.mergedAt))
  );
}

export function isTicketMergeNotice(value: unknown): value is TicketMergeNotice {
  return (
    isDynamicRecord(value) &&
    isText(value.id, ID_LIMIT) &&
    isNullableId(value.ticketId) &&
    isNullableId(value.ticketKey) &&
    isText(value.title, TICKET_MERGE_TITLE_LIMIT) &&
    isNullablePrNumber(value.prNumber) &&
    (value.prUrl === null || (isText(value.prUrl, URL_LIMIT) && isHttpsUrl(value.prUrl))) &&
    isTicketMergeVerdict(value.verdict) &&
    isNullableQualityScore(value.qualityScore) &&
    isTicketMergeCiStatus(value.ci) &&
    isText(value.mergedAt, 80)
  );
}

export function isTicketMergeOpenRequest(value: unknown): value is TicketMergeOpenRequest {
  return (
    isDynamicRecord(value) &&
    isText(value.noticeId, ID_LIMIT) &&
    (value.target === "ticket" || value.target === "pull-request")
  );
}

export function isTicketMergeOpenedEvent(value: unknown): value is TicketMergeOpenedEvent {
  return isDynamicRecord(value) && isTicketMergeNotice(value.notice);
}

function isTicketMergeVerdict(value: unknown): value is TicketMergeVerdict {
  return value === "PASS" || value === "PASS+NOTES";
}

function isTicketMergeCiStatus(value: unknown): value is TicketMergeCiStatus {
  return value === "green" || value === "none";
}

function isText(value: unknown, limit: number): value is string {
  return isString(value) && value.length > 0 && value.length <= limit;
}

function isNullableId(value: unknown): value is string | null {
  return value === null || isText(value, ID_LIMIT);
}

function isNullablePrNumber(value: unknown): value is number | null {
  return value === null || (isNumber(value) && Number.isSafeInteger(value) && value > 0 && value < PR_NUMBER_LIMIT);
}

function isNullableQualityScore(value: unknown): value is number | null {
  return value === null || (isNumber(value) && Number.isFinite(value) && value >= 0 && value <= 10);
}
