import type { AgentTask, AgentTasksSnapshot, BoardTicket } from "@openbot/contracts/ipc";
import { Button, IconButton, Pause, Play, Square, X } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { agentMood, ThreadCount, TicketCard, type TicketsBoardData } from "./TicketsBoard";
import { openThreads, threadStateLabel } from "./tickets-model";

/** What the agent panel can do with a work thread. Each one calls the agent task endpoint of the same name. */
export interface TicketsThreadControls {
  onStopThread: (thread: AgentTask) => void;
  onPauseThread: (thread: AgentTask) => void;
  onResumeThread: (thread: AgentTask) => void;
}

interface TicketsAgentPanelProps extends TicketsBoardData, TicketsThreadControls {
  agent: AgentProfile;
  snapshot: AgentTasksSnapshot | undefined;
  onClose: () => void;
  onOpenTicket: (ticketId: string) => void;
}

/**
 * The panel of one agent: its open work threads, each with its ticket, branch, worktree and controls,
 * then its queue: the tickets that wait for it and the messages that wait in its threads.
 */
export function TicketsAgentPanel(props: TicketsAgentPanelProps) {
  const { t } = useText();
  const threads = () => openThreads(props.snapshot);
  const ticketOf = (thread: AgentTask) => props.tickets.find((ticket) => ticket.taskId === thread.id);
  const queue = (): BoardTicket[] =>
    props.tickets
      .filter(
        (ticket) =>
          ticket.agentId === props.agent.id &&
          !ticket.taskId &&
          (ticket.status === "backlog" || ticket.status === "queued"),
      )
      .sort((left, right) => left.order - right.order);
  const waitingMessages = () => threads().reduce((count, thread) => count + thread.queuedMessages.length, 0);
  return (
    <aside class="tickets-side" aria-label={props.agent.name}>
      <header class="tickets-side-header">
        <AgentAvatar agent={props.agent} mood={agentMood(props.snapshot)} class="tickets-panel-avatar" />
        <h3>
          {props.agent.name}
          {" · "}
          <ThreadCount snapshot={props.snapshot} class="tickets-lane-count" />
        </h3>
        <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <div class="tickets-side-scroll">
        <section class="tickets-section">
          <h4>{t("tickets.panel.threads")}</h4>
          <For
            each={threads()}
            keyed={(thread) => thread.id}
            fallback={<p class="tickets-muted">{t("tickets.panel.noThreads")}</p>}
          >
            {(thread) => (
              <TicketsThreadRow
                onStopThread={props.onStopThread}
                onPauseThread={props.onPauseThread}
                onResumeThread={props.onResumeThread}
                thread={thread()}
                ticket={ticketOf(thread())}
                onOpenTicket={props.onOpenTicket}
              />
            )}
          </For>
        </section>
        <section class="tickets-section">
          <h4>{t("tickets.panel.queue")}</h4>
          <Show when={waitingMessages() > 0}>
            <p class="tickets-muted">{t("tickets.panel.queuedMessages", { count: waitingMessages() })}</p>
          </Show>
          <Show when={queue().length === 0 && waitingMessages() === 0}>
            <p class="tickets-muted">{t("tickets.panel.queueEmpty")}</p>
          </Show>
          <For each={queue()} keyed={(ticket) => ticket.id}>
            {(ticket) => (
              <TicketCard
                agents={props.agents}
                tickets={props.tickets}
                snapshots={props.snapshots}
                ticket={ticket()}
                selected={false}
                onSelect={props.onOpenTicket}
              />
            )}
          </For>
        </section>
      </div>
    </aside>
  );
}

function TicketsThreadRow(
  props: TicketsThreadControls & {
    thread: AgentTask;
    ticket: BoardTicket | undefined;
    onOpenTicket: (ticketId: string) => void;
  },
) {
  const { t } = useText();
  const worktree = () => {
    const workspace = props.thread.workspace;
    return workspace?.mode === "worktree" ? workspace : null;
  };
  const canPause = () =>
    props.thread.state === "running" || props.thread.state === "queued" || props.thread.queuedMessages.length > 0;
  return (
    <article class="tickets-thread" aria-label={props.ticket?.title ?? props.thread.title}>
      <div class="tickets-thread-head">
        <span class="tickets-thread-title">{props.ticket?.title ?? props.thread.title}</span>
        <span class="tickets-thread-state" data-state={props.thread.state}>
          {t(threadStateLabel(props.thread))}
        </span>
      </div>
      <Show when={props.thread.state === "running" ? props.thread.progress : null}>
        {(progress) => <p class="tickets-muted">{progress()}</p>}
      </Show>
      <Show when={props.thread.workspace}>
        <dl class="tickets-facts">
          <Show
            when={worktree()}
            fallback={
              <>
                <dt>{t("tickets.panel.worktree")}</dt>
                <dd>{t("tickets.panel.sharedWorkspace")}</dd>
              </>
            }
          >
            {(tree) => (
              <>
                <dt>{t("tickets.panel.branch")}</dt>
                <dd>{tree().branch}</dd>
                <dt>{t("tickets.panel.worktree")}</dt>
                <dd>{tree().path}</dd>
              </>
            )}
          </Show>
        </dl>
      </Show>
      <div class="tickets-actions">
        <Show when={props.ticket}>
          {(ticket) => (
            <Button variant="outline" size="sm" onClick={() => props.onOpenTicket(ticket().id)}>
              {t("tickets.panel.openTicket")}
            </Button>
          )}
        </Show>
        <Show when={props.thread.state === "running"}>
          <Button variant="outline" size="sm" onClick={() => props.onStopThread(props.thread)}>
            <Square aria-hidden="true" />
            {t("tickets.panel.stop")}
          </Button>
        </Show>
        {/* Pause and resume exist only on this computer: a joined server's thread carries no `pausedAt`. */}
        <Show when={props.thread.pausedAt !== undefined}>
          <Show
            when={props.thread.pausedAt}
            fallback={
              <Show when={canPause()}>
                <Button variant="outline" size="sm" onClick={() => props.onPauseThread(props.thread)}>
                  <Pause aria-hidden="true" />
                  {t("tickets.panel.pause")}
                </Button>
              </Show>
            }
          >
            <Button variant="outline" size="sm" onClick={() => props.onResumeThread(props.thread)}>
              <Play aria-hidden="true" />
              {t("tickets.panel.resume")}
            </Button>
          </Show>
        </Show>
      </div>
    </article>
  );
}
