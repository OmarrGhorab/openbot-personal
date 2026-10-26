/**
 * The banner of a paused Monitor view: "Feed paused · 6 new events are waiting" and a Resume
 * button. Pause only stops the view; the agents keep working, and Resume shows what waited.
 */

import { Button, Pause } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { useText } from "../../text";

export interface MonitorPausedBannerProps {
  /** How many new events wait. */
  count: number;
  onResume: () => void;
  class?: string | undefined;
}

export function MonitorPausedBanner(props: MonitorPausedBannerProps): JSX.Element {
  const { t } = useText();
  return (
    <div class={["monitor-paused-banner", props.class]} role="status">
      <Pause class="monitor-paused-banner-icon" aria-hidden="true" />
      <span class="monitor-paused-banner-text">{t("monitor.pause.banner", { count: props.count })}</span>
      <Button type="button" variant="default" size="sm" class="monitor-paused-banner-resume" onClick={props.onResume}>
        {t("monitor.pause.resumeShort")}
      </Button>
    </div>
  );
}
