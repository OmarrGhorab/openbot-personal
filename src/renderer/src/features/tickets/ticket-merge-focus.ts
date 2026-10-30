import { createSignal } from "solid-js";

/**
 * A request to open one board ticket of this computer on the Tickets page. "View ticket" on a merge
 * notice sets it; the Tickets page selects the ticket and clears it.
 *
 * It lives in a module, not in a provider, because a server switch disposes everything under the
 * server scope. The request has to wait there for the Tickets page of this computer to mount.
 * Each request is a new object, so "View ticket" twice on the same ticket opens it again.
 */
export interface TicketFocusRequest {
  ticketId: string;
}

const [requestedTicket, setRequestedTicket] = createSignal<TicketFocusRequest | null>(null);

/** The open request, or null. */
export const ticketFocusRequest = requestedTicket;

export function requestTicketFocus(ticketId: string): void {
  setRequestedTicket({ ticketId });
}

/** Clears the request after the Tickets page selected its ticket. A newer request stays. */
export function clearTicketFocus(request: TicketFocusRequest): void {
  setRequestedTicket((current) => (current === request ? null : current));
}
