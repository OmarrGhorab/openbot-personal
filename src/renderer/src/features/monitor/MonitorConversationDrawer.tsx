import type { MonitorConversation, MonitorSnapshot } from "@openbot/contracts/ipc";
import { ConversationDrawer, type ConversationDrawerAgent } from "@openbot/ui/features/monitor/ConversationDrawer";
import { monitorAgo } from "@openbot/ui/features/monitor/monitor-time";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { useMonitor } from "./monitor-context";

/**
 * The conversation drawer of the Monitor: the messages between the two agents of a canvas line label
 * or a "Talking to" name. The count and the last time come from the snapshot, the same numbers the
 * line label shows. The messages reload when the snapshot changes, so a new message appears.
 */
export function MonitorConversationDrawer() {
  const { t, format } = useText();
  const monitor = useMonitor();
  const [conversation, setConversation] = createSignal<MonitorConversation | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let generation = 0;

  // A new pair, or a new snapshot of the channel, reads the messages again. A slow older read is
  // dropped, so an old answer never replaces a newer one.
  createEffect(
    () => [monitor.state.conversation, monitor.state.snapshot?.revision ?? null] as const,
    ([ids]) => {
      if (!ids) {
        generation += 1;
        setConversation(null);
        setLoading(false);
        setFailed(false);
        return;
      }
      generation += 1;
      const read = generation;
      setLoading(true);
      setFailed(false);
      monitor
        .loadConversation(ids)
        .then((next) => {
          if (read !== generation) return;
          setConversation(next);
        })
        .catch(() => {
          if (read !== generation) return;
          setConversation(null);
          setFailed(true);
        })
        .finally(() => {
          if (read === generation) setLoading(false);
        });
    },
  );

  const agentOf = (snapshot: MonitorSnapshot, agentId: string) => snapshot.agents.find((agent) => agent.id === agentId);

  const drawer = createMemo(() => {
    const ids = monitor.state.conversation;
    const snapshot = monitor.state.snapshot;
    if (!ids || !snapshot) return null;
    const first = agentOf(snapshot, ids[0]);
    const second = agentOf(snapshot, ids[1]);
    if (!first || !second) return null;
    const pair = snapshot.pairs.find((entry) => entry.agentIds.includes(ids[0]) && entry.agentIds.includes(ids[1]));
    const count = pair?.count ?? 0;
    const agentsOf = (agent: typeof first): ConversationDrawerAgent => ({
      id: agent.id,
      name: agent.name,
      agent: { avatarSeed: agent.avatarSeed, avatarHue: agent.avatarHue, avatarUrl: agent.avatarUrl },
      openThreadLabel: t("monitor.conversation.openThread", { name: agent.name }),
    });
    const shown = conversation();
    return {
      agents: [agentsOf(first), agentsOf(second)] as const,
      title: t("monitor.conversation.title", { first: first.name, second: second.name }),
      countText: t("monitor.conversation.count", { count }),
      lastText: pair ? t("monitor.conversation.last", { time: monitorAgo(pair.lastAt, new Date(), t) }) : null,
      messages: (shown?.messages ?? []).map((message) => {
        const sender = agentOf(snapshot, message.senderAgentId);
        return {
          id: message.id,
          senderName: sender?.name ?? message.senderAgentId,
          sender: {
            avatarSeed: sender?.avatarSeed ?? message.senderAgentId,
            avatarHue: sender?.avatarHue ?? null,
            avatarUrl: sender?.avatarUrl ?? null,
          },
          time: format.date(new Date(message.at), { hour: "2-digit", minute: "2-digit" }),
          text: message.text,
        };
      }),
      loading: loading(),
      error: failed() ? t("monitor.conversation.error") : null,
      notice:
        shown && shown.total > shown.messages.length
          ? t("monitor.conversation.truncated", { shown: shown.messages.length, total: shown.total })
          : null,
    };
  });

  return (
    <Show when={drawer()}>
      {(props) => (
        <ConversationDrawer
          open
          onClose={() => monitor.closeConversation()}
          {...props()}
          onOpenThread={(agentId) => monitor.openThread(agentId)}
        />
      )}
    </Show>
  );
}
