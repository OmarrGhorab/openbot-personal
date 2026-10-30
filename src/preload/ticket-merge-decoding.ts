// What main sends the window about a ticket the Reviewer merged: the toast notice, and the request to
// open the ticket from the island or the system notification.

import {
  isTicketMergeNotice,
  isTicketMergeOpenedEvent,
  type TicketMergeNotice,
  type TicketMergeOpenedEvent,
} from "@openbot/contracts/ipc";

export function decodeTicketMergeNotice(value: unknown): TicketMergeNotice {
  if (!isTicketMergeNotice(value)) throw new Error("Invalid ticket merge notice.");
  return pickNotice(value);
}

export function decodeTicketMergeOpenedEvent(value: unknown): TicketMergeOpenedEvent {
  if (!isTicketMergeOpenedEvent(value)) throw new Error("Invalid ticket merge opened event.");
  return { notice: pickNotice(value.notice) };
}

// Only the fields the contract names reach the window, whatever else the value carries.
function pickNotice(notice: TicketMergeNotice): TicketMergeNotice {
  return {
    id: notice.id,
    ticketId: notice.ticketId,
    ticketKey: notice.ticketKey,
    title: notice.title,
    prNumber: notice.prNumber,
    prUrl: notice.prUrl,
    verdict: notice.verdict,
    qualityScore: notice.qualityScore,
    ci: notice.ci,
    mergedAt: notice.mergedAt,
  };
}
