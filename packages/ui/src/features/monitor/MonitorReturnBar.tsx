/**
 * The way back from an agent thread to the Monitor, after "Open thread" in the agent popup opened
 * the thread. It sits above the conversation.
 */

import { ArrowLeft, Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { useText } from "../../text";

export interface MonitorReturnBarProps {
  onBack: () => void;
}

export function MonitorReturnBar(props: MonitorReturnBarProps): JSX.Element {
  const { t } = useText();
  return (
    <nav class="monitor-return-bar" aria-label={t("monitor.sidebar.label")}>
      <Button type="button" variant="ghost" size="sm" data-cuelume-navigate="" onClick={() => props.onBack()}>
        <ArrowLeft class="monitor-return-arrow" aria-hidden="true" />
        {t("monitor.return.back")}
      </Button>
    </nav>
  );
}
