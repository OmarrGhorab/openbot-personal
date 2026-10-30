import type { TicketMergeNotice } from "@openbot/contracts/ipc";
import { Button, GitMerge } from "@openbot/ui";
import { Show } from "solid-js";
import { currentText } from "../../text";

interface TicketMergeToastProps {
  notice: TicketMergeNotice;
  onViewTicket: () => void;
  onViewPullRequest: () => void;
}

/**
 * The in-app toast for a ticket the Reviewer merged: the title, one line of facts (PASS, Quality,
 * CI) and "View ticket" / "View PR". It shows structured facts only, never a diff or agent text.
 * Raise it with sonner's `unstyled: true`.
 */
export function TicketMergeToast(props: TicketMergeToastProps) {
  // The app's Toaster renders outside the text provider, so `useText()` would always give English.
  const { t } = currentText();
  const body = () =>
    props.notice.prNumber === null
      ? t("notification.ticketMerged.bodyNoPullRequest")
      : t("notification.ticketMerged.body", { number: String(props.notice.prNumber) });
  const facts = () => {
    const parts = [
      t(props.notice.verdict === "PASS" ? "notification.ticketMerged.pass" : "notification.ticketMerged.passWithNotes"),
    ];
    const score = props.notice.qualityScore;
    if (score !== null) {
      parts.push(
        t("notification.ticketMerged.quality", { score: Number.isInteger(score) ? String(score) : score.toFixed(1) }),
      );
    }
    if (props.notice.ci === "green") parts.push(t("notification.ticketMerged.ciGreen"));
    return parts.join(" · ");
  };
  return (
    <div class="ticket-merge-toast" role="status">
      <span class="ticket-merge-toast-icon" aria-hidden="true">
        <GitMerge />
      </span>
      <div class="ticket-merge-toast-text">
        <strong class="ticket-merge-toast-title">
          {t("notification.ticketMerged.title", { ticket: props.notice.title })}
        </strong>
        <span class="ticket-merge-toast-body">{body()}</span>
        <span class="ticket-merge-toast-facts">{facts()}</span>
      </div>
      <div class="ticket-merge-toast-actions">
        <Show when={props.notice.ticketId !== null}>
          <Button type="button" size="sm" onClick={() => props.onViewTicket()}>
            {t("notification.ticketMerged.viewTicket")}
          </Button>
        </Show>
        <Show when={props.notice.prUrl !== null}>
          <Button type="button" variant="outline" size="sm" onClick={() => props.onViewPullRequest()}>
            {t("notification.ticketMerged.viewPullRequest")}
          </Button>
        </Show>
      </div>
    </div>
  );
}
