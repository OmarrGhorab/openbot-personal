import type { AgentEvent, MonitorSnapshot } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import {
  type AskAgentMessage,
  AskAgentPanel,
  type AskAgentSource,
  type AskAgentSuggestion,
} from "@openbot/ui/features/monitor/AskAgentPanel";
import { useText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { useMonitor } from "./monitor-context";

/** The questions the panel suggests, as catalog keys. Each one is sent as its translated text. */
const SUGGESTIONS = [
  "monitor.ask.suggest.lastHour",
  "monitor.ask.suggest.blocked",
  "monitor.ask.suggest.doing",
] as const;

/**
 * The text the lead agent gets with a question: the channel as the Monitor shows it. The snapshot
 * already redacts tool-call text and errors. The whole prompt is redacted again before it is sent.
 */
export function monitorAskPrompt(snapshot: MonitorSnapshot, question: string): string {
  const lines = snapshot.agents.map((agent) => {
    const task = snapshot.tasks.find((entry) => entry.id === agent.currentTaskId);
    const step = agent.step ? `, step ${agent.step.index} of ${agent.step.total}` : "";
    const error = agent.error ? `, error: ${agent.error}` : "";
    return `- ${agent.name} (${agent.status}${agent.lead ? ", channel lead" : ""}): ${task?.title ?? "no task"}${step}${error}`;
  });
  const blocked = snapshot.agents
    .filter((agent) => agent.status === "waiting" || agent.status === "error")
    .map((agent) => agent.name);
  const recent = snapshot.events.slice(0, 20).map((event) => `- ${event.at}: ${event.kind}`);
  return redactText(
    [
      `Channel: ${snapshot.channelName}`,
      "Agents:",
      ...lines,
      `Blocked or failed agents: ${blocked.length > 0 ? blocked.join(", ") : "none"}`,
      "Recent events:",
      ...recent,
      "",
      `Question: ${question}`,
      "Answer from this channel snapshot only. Name the agents involved. Answer in the language of the question.",
    ].join("\n"),
  );
}

/** The agent a conversation event is about, when it names one. */
function eventAgentId(event: AgentEvent): string | null {
  if (event.type === "conversation") return event.snapshot.agentId;
  if (event.type === "conversation-invalidated" || event.type === "conversation-delta") return event.agentId;
  return null;
}

/**
 * The "Ask an agent about this channel" panel. The question goes to the channel lead through the
 * existing send API, with the redacted snapshot as context. The reply is read from the lead's
 * conversation when an event says it changed. Stop only stops reading: the agent keeps its turn.
 */
export function MonitorAskPanel(props: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const monitor = useMonitor();
  const [messages, setMessages] = createSignal<AskAgentMessage[]>([]);
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let stopReading: (() => void) | null = null;
  let counter = 0;

  function push(message: AskAgentMessage) {
    setMessages((list) => [...list, message]);
  }
  function update(id: string, change: (message: AskAgentMessage) => AskAgentMessage) {
    setMessages((list) => list.map((message) => (message.id === id ? change(message) : message)));
  }
  function nextId(kind: string) {
    counter += 1;
    return `${kind}-${counter}`;
  }
  function endReading() {
    stopReading?.();
    stopReading = null;
  }
  onCleanup(endReading);

  /** The agents the answer names, by their name in the snapshot. */
  function sourcesIn(text: string): AskAgentSource[] {
    const snapshot = monitor.state.snapshot;
    if (!snapshot) return [];
    return snapshot.agents
      .filter((agent) => text.includes(agent.name))
      .map((agent) => ({ agentId: agent.id, name: agent.name, status: agent.status }));
  }

  async function ask(question: string) {
    const snapshot = monitor.state.snapshot;
    const lead = snapshot?.agents.find((agent) => agent.lead) ?? snapshot?.agents[0];
    if (!snapshot || !lead) {
      push({ id: nextId("error"), role: "error", text: t("monitor.ask.noAgent") });
      return;
    }
    endReading();
    const sentAt = new Date().toISOString();
    const answerId = nextId("answer");
    push({ id: nextId("user"), role: "user", text: question });
    push({ id: answerId, role: "answer", text: "", status: "streaming", sources: [] });
    setBusy(true);

    const readReply = async () => {
      const conversation = await window.openbot.agent.readConversation(lead.id);
      const reply = conversation.messages
        .filter(
          (message) => (message.author === "assistant" || message.author === "agent") && message.createdAt >= sentAt,
        )
        .at(-1);
      if (!reply) return;
      const done = reply.status === "completed";
      update(answerId, () => ({
        id: answerId,
        role: "answer",
        text: reply.text,
        status: reply.status === "failed" ? "failed" : done ? "completed" : "streaming",
        sources: done ? sourcesIn(reply.text) : [],
      }));
      if (done || reply.status === "failed") {
        endReading();
        setBusy(false);
      }
    };

    const unsubscribe = window.openbot.agent.onEvent((event) => {
      if (eventAgentId(event) === lead.id) void readReply();
    });
    stopReading = () => {
      unsubscribe();
      setBusy(false);
    };
    try {
      await window.openbot.agent.sendMessage({
        agentId: lead.id,
        text: monitorAskPrompt(snapshot, question),
        clientMessageId: crypto.randomUUID(),
      });
      await readReply();
    } catch {
      update(answerId, () => ({ id: answerId, role: "answer", text: "", status: "failed", sources: [] }));
      endReading();
      setBusy(false);
    }
  }

  function stop() {
    endReading();
    setMessages((list) =>
      list.map((message) =>
        message.role === "answer" && message.status === "streaming" ? { ...message, status: "stopped" } : message,
      ),
    );
  }

  function send() {
    const question = draft().trim();
    if (question === "" || busy()) return;
    setDraft("");
    void ask(question);
  }

  const suggestions = (): AskAgentSuggestion[] => SUGGESTIONS.map((key) => ({ id: key, label: t(key) }));

  return (
    <AskAgentPanel
      open={props.open}
      onClose={() => {
        endReading();
        props.onClose();
      }}
      channelName={monitor.state.snapshot?.channelName ?? ""}
      suggestions={suggestions()}
      messages={messages()}
      draft={draft()}
      onDraft={setDraft}
      onSend={send}
      onSuggest={(label) => void ask(label)}
      onStop={stop}
      onOpenAgent={(agentId) => monitor.selectAgent(agentId)}
      busy={busy()}
    />
  );
}
