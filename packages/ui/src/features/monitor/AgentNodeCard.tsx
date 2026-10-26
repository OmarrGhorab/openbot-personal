/**
 * One agent on the Monitor canvas: its icon, role and name, the task it works on, how far it is,
 * and a status footer. The whole card selects the agent when `onSelect` is set. The card does not
 * place itself: the canvas positions it.
 */

import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { MONITOR_STATUS_MOOD, type MonitorStatus } from "./monitor-status";
import { monitorSince } from "./monitor-time";
import { ProgressBar, type ProgressBarProps } from "./ProgressBar";
import { StatusLine } from "./StatusPill";

export interface AgentNodeCardProps {
  agent: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl">;
  name: string;
  /** What the agent is in the channel, such as "Engineer". */
  role?: string | undefined;
  /** The task text. */
  task?: string | null | undefined;
  progress?: Omit<ProgressBarProps, "status" | "class"> | undefined;
  status: MonitorStatus;
  /** Text in place of the status word, such as "Waiting on Chief". */
  statusLabel?: string | undefined;
  /** When the status started, as an ISO time. The footer shows how long ago. */
  since?: string | null | undefined;
  /** The clock for `since`. Defaults to the time of the render. */
  now?: Date | undefined;
  selected?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  class?: string | undefined;
}

export function AgentNodeCard(props: AgentNodeCardProps): JSX.Element {
  const { t } = useText();
  const since = () => (props.since ? monitorSince(props.since, props.now ?? new Date(), t) : undefined);
  return (
    <article
      class={["monitor-node", props.class]}
      data-status={props.status}
      data-selected={props.selected ? "" : undefined}
      data-avatar-hover=""
    >
      <Show when={props.onSelect}>
        {(onSelect) => (
          <Button
            type="button"
            variant="ghost"
            class="monitor-select"
            aria-label={t("monitor.node.select", { name: props.name })}
            aria-pressed={props.selected ? "true" : "false"}
            onClick={() => onSelect()()}
          />
        )}
      </Show>
      <header class="monitor-node-header">
        <AgentAvatar class="monitor-node-avatar" agent={props.agent} mood={MONITOR_STATUS_MOOD[props.status]} />
        <div class="monitor-node-title">
          <Show when={props.role}>
            <span class="monitor-node-role">{props.role}</span>
          </Show>
          <span class="monitor-node-name">{props.name}</span>
        </div>
      </header>
      <Show when={props.task || props.progress}>
        <div class="monitor-node-body">
          <Show when={props.task}>
            <p class="monitor-node-task">{props.task}</p>
          </Show>
          <Show when={props.progress}>{(progress) => <ProgressBar {...progress()} status={props.status} />}</Show>
        </div>
      </Show>
      <footer class="monitor-node-footer">
        <StatusLine status={props.status} label={props.statusLabel} meta={since()} />
      </footer>
    </article>
  );
}
