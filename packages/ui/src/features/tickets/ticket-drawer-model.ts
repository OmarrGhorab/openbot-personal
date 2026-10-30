import type { BoardTicket, BoardTicketProvider, BoardTicketStatus, ConversationMessage } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";

/** The name of each ticket system. */
export const TICKET_PROVIDER_LABEL = {
  github: "tickets.sync.provider.github",
  jira: "tickets.sync.provider.jira",
  linear: "tickets.sync.provider.linear",
} as const satisfies Record<BoardTicketProvider, AppTextKey>;

/** The short name of each status step in the drawer. Needs review is "Review" there. */
export const TICKET_STEP_LABEL = {
  backlog: "tickets.status.backlog",
  queued: "tickets.status.queued",
  running: "tickets.status.running",
  needs_review: "tickets.drawer.step.review",
  done: "tickets.status.done",
} as const satisfies Record<BoardTicketStatus, AppTextKey>;

/** How many tool calls the finished turns of a thread made, from the trace of each turn. */
export function threadToolCalls(messages: readonly ConversationMessage[]) {
  let calls = 0;
  for (const message of messages) {
    for (const step of message.trace?.steps ?? []) if (step.kind === "tool") calls += 1;
  }
  return calls;
}

/** The tokens that the provider reported for all the finished turns of a thread. */
export function threadTokens(messages: readonly ConversationMessage[]) {
  let tokens = 0;
  for (const message of messages) tokens += message.trace?.tokens ?? 0;
  return tokens;
}

/** When the work of a ticket started: when it last entered Running, else Queued, else when it was created. */
export function ticketStartedAt(ticket: BoardTicket): string {
  return ticket.statusTimes.running ?? ticket.statusTimes.queued ?? ticket.createdAt;
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

/**
 * A time as a distance from now in the reader's language, such as "14 minutes ago", or "14m ago" with
 * the narrow style. Intl gives the words, so no catalog key is needed.
 */
export function relativeTime(
  locale: string,
  iso: string,
  now: number,
  style: Intl.RelativeTimeFormatStyle = "long",
): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size || unit === "second") {
      // Under a minute reads as "now".
      if (unit === "second") return formatter.format(0, "second");
      return formatter.format(Math.trunc(seconds / size), unit);
    }
  }
  return formatter.format(0, "second");
}
