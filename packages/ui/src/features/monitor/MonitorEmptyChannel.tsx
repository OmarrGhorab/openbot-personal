/**
 * The canvas of a channel with no activity: an icon, the heading, a short text, and the two ways to
 * start work. Each action shows only when the caller passes it.
 *
 * Shared: it takes the heading and the actions as props.
 */

import { Button, Workflow } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";

export interface MonitorEmptyChannelProps {
  /** The heading, such as "Nothing running in #launch-q4". */
  title: string;
  /** Opens the add-agent dialog. The button shows only when this is set. */
  onAddAgent?: (() => void) | undefined;
  /** Opens the routines view. The button shows only when this is set. */
  onCreateRoutine?: (() => void) | undefined;
}

export function MonitorEmptyChannel(props: MonitorEmptyChannelProps): JSX.Element {
  const { t } = useText();
  return (
    <div class="monitor-empty-channel">
      <span class="monitor-empty-channel-icon" aria-hidden="true">
        <Workflow />
      </span>
      <h2 class="monitor-empty-channel-title">{props.title}</h2>
      <p class="monitor-empty-channel-text">{t("monitor.empty.text")}</p>
      <Show when={props.onAddAgent || props.onCreateRoutine}>
        <div class="monitor-empty-channel-actions">
          <Show when={props.onAddAgent}>
            {(add) => (
              <Button type="button" variant="outline" onClick={() => add()()}>
                {t("monitor.empty.addAgent")}
              </Button>
            )}
          </Show>
          <Show when={props.onCreateRoutine}>
            {(create) => (
              <Button type="button" variant="outline" onClick={() => create()()}>
                {t("monitor.empty.createRoutine")}
              </Button>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
