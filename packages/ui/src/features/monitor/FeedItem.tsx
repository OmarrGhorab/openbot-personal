/**
 * One event in the Monitor feed: "Researcher handed off to Designer · 2m ago", with the message or
 * task text and optional progress in a card below. The consumer writes the verb in the reader's
 * language; agent names and message text are user content.
 */

import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { MONITOR_STATUS_MOOD, type MonitorStatus } from "./monitor-status";
import { monitorAgo } from "./monitor-time";
import { ProgressBar, type ProgressBarProps } from "./ProgressBar";

export interface FeedItemProps {
  /** The agent the event is about. Without it the item shows no icon, as for a person's message. */
  agent?: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl"> | undefined;
  actor: string;
  /** What the actor did, such as "handed off to". */
  verb?: string | undefined;
  /** Who or what the action is about, such as another agent. */
  target?: string | undefined;
  /** When the event happened, as an ISO time. */
  at?: string | null | undefined;
  /** The clock for `at`. Defaults to the time of the render. */
  now?: Date | undefined;
  text?: string | null | undefined;
  progress?: Omit<ProgressBarProps, "class"> | undefined;
  /** The actor's status. It sets the face of the agent icon. */
  status?: MonitorStatus | undefined;
  /** The tone of the event. `error` gives the card a red border and the target red text; `done` gives the target the done colour. */
  tone?: MonitorStatus | null | undefined;
  class?: string | undefined;
}

export function FeedItem(props: FeedItemProps): JSX.Element {
  const { t } = useText();
  const at = () => (props.at ? monitorAgo(props.at, props.now ?? new Date(), t) : undefined);
  return (
    <article class={["monitor-feed-item", props.class]} data-tone={props.tone ?? undefined}>
      <Show when={props.agent} fallback={<span class="monitor-feed-avatar" aria-hidden="true" />}>
        {(agent) => (
          <AgentAvatar
            class="monitor-feed-avatar"
            agent={agent()}
            mood={props.status ? MONITOR_STATUS_MOOD[props.status] : "idle"}
          />
        )}
      </Show>
      <div class="monitor-feed-body">
        <div class="monitor-feed-head">
          <span class="monitor-feed-actor">{props.actor}</span>
          <Show when={props.verb}>
            <span class="monitor-feed-verb">{props.verb}</span>
          </Show>
          <Show when={props.target}>
            <span class="monitor-feed-target">{props.target}</span>
          </Show>
          <Show when={at()}>
            {(time) => (
              <time class="monitor-feed-time" datetime={props.at ?? undefined}>
                {time()}
              </time>
            )}
          </Show>
        </div>
        <Show when={props.text || props.progress}>
          <div class="monitor-feed-card">
            <Show when={props.text}>
              <p class="monitor-feed-text" dir="auto">
                {props.text}
              </p>
            </Show>
            <Show when={props.progress}>{(progress) => <ProgressBar {...progress()} />}</Show>
          </div>
        </Show>
      </div>
    </article>
  );
}
