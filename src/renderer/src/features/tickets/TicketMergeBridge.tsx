import { LOCAL_SERVER_ID, type OpenBotDesktopApi, type TicketMergeNotice } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { TicketMergeToast } from "@openbot/ui/features/tickets/TicketMergeToast";
import { currentText } from "@openbot/ui/text";
import { onSettled } from "solid-js";
import { actionToast } from "../../action-toast";
import { usePlatform } from "../../platform";
import { useServerSelection } from "../servers/server-selection";
import { useServers } from "../servers/servers-context";
import { useUsage } from "../usage/usage-context";
import { requestTicketFocus } from "./ticket-merge-focus";

/** How long the merge toast stays. The island and the system notification keep their own times. */
const TOAST_MS = 8_000;

type TicketMergePort = Pick<
  OpenBotDesktopApi["notifications"],
  "onTicketMerged" | "onTicketMergeOpened" | "openTicketMerge"
>;

/** Read on each call: stories replace `window.openbot` per case. */
function ticketMergePort(): TicketMergePort {
  return window.openbot.notifications;
}

/**
 * The window side of a ticket the Reviewer merged (#199). Main sends the notice; this shows the
 * in-app toast. "View ticket" from the toast, the island or the system notification opens the
 * ticket on the Tickets page of this computer. "View PR" asks main, which opens only the https
 * URL that it holds for the notice. The window sends the notice id, never a URL.
 */
export function TicketMergeBridge() {
  const platform = usePlatform();
  const { activeServerId } = useServers();
  const { selectServer } = useServerSelection();
  const usage = useUsage();

  /** The board of a merge is on this computer, so another server is switched away first. */
  async function openTicket(notice: TicketMergeNotice): Promise<void> {
    const ticketId = notice.ticketId;
    if (ticketId === null) return;
    requestTicketFocus(ticketId);
    if (activeServerId() !== LOCAL_SERVER_ID && !(await selectServer(LOCAL_SERVER_ID, false))) return;
    usage.openTasks(LOCAL_SERVER_ID, null);
  }

  function openPullRequest(notice: TicketMergeNotice): void {
    ticketMergePort()
      .openTicketMerge({ noticeId: notice.id, target: "pull-request" })
      .catch((error: unknown) => {
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("notification.ticketMerged.openFailed")));
      });
  }

  function showToast(notice: TicketMergeNotice): void {
    const id = `ticket-merge-${notice.id}`;
    toast(
      () => (
        <TicketMergeToast
          notice={notice}
          onViewTicket={() => {
            toast.dismiss(id);
            void openTicket(notice).catch(() => undefined);
          }}
          onViewPullRequest={() => {
            toast.dismiss(id);
            openPullRequest(notice);
          }}
        />
      ),
      { id, duration: TOAST_MS, unstyled: true, closeButton: false, class: "ticket-merge-toast-host" },
    );
  }

  onSettled(() => {
    if (platform.landingPreview) return;
    const port = ticketMergePort();
    const stopMerged = port.onTicketMerged(showToast);
    const stopOpened = port.onTicketMergeOpened(({ notice }) => {
      void openTicket(notice).catch(() => undefined);
    });
    return () => {
      stopMerged();
      stopOpened();
    };
  });

  return null;
}
