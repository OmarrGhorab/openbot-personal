import { Button, Dialog, IconButton, Input, Search, X } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useChannels } from "../channels/channels-context";
import { matchesAgentSearch } from "../channels/channels-draft";
import { useMonitor } from "./monitor-context";
import { changeChannelMember } from "./monitor-members";

/**
 * Adds agents to the open channel. It lists the agents that are not members yet; Add saves the
 * channel with the agent as a member. The new agent shows on the canvas when the channel changes.
 */
export function MonitorAddAgentDialog() {
  const { t } = useText();
  const monitor = useMonitor();
  const channels = useChannels();
  const [search, setSearch] = createSignal("");
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const memberIds = () => new Set((monitor.state.snapshot?.agents ?? []).map((agent) => agent.id));
  const candidates = createMemo(() =>
    channels.agents().filter((agent) => !memberIds().has(agent.id) && matchesAgentSearch(agent, search())),
  );

  async function add(agentId: string) {
    const channelId = monitor.state.snapshot?.channelId;
    if (!channelId || busy() !== null) return;
    setBusy(agentId);
    setError(null);
    try {
      if (!(await changeChannelMember(channels, channelId, agentId, true))) setError(t("monitor.addAgent.error"));
    } catch {
      setError(t("monitor.addAgent.error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog.Root
      open={monitor.state.addAgentOpen}
      onOpenChange={(open) => {
        if (!open) monitor.closeAddAgent();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="channel-dialog-backdrop">
          <Dialog.Content class="monitor-add-agent">
            <header class="monitor-add-agent-header">
              <div class="monitor-add-agent-heading">
                <Dialog.Title class="monitor-add-agent-title">{t("monitor.addAgent.title")}</Dialog.Title>
                <Dialog.Description class="monitor-add-agent-description">
                  {t("monitor.addAgent.description")}
                </Dialog.Description>
              </div>
              <IconButton label={t("common.close")} variant="ghost" onClick={() => monitor.closeAddAgent()}>
                <X aria-hidden="true" />
              </IconButton>
            </header>
            <label class="search-field monitor-add-agent-search">
              <Search class="channel-search-icon" aria-hidden="true" />
              <Input
                type="search"
                aria-label={t("monitor.addAgent.search")}
                placeholder={t("monitor.addAgent.search")}
                value={search()}
                onValueChange={setSearch}
              />
            </label>
            <div class="monitor-add-agent-body">
              <Show
                when={candidates().length > 0}
                fallback={<p class="monitor-add-agent-empty">{t("monitor.addAgent.empty")}</p>}
              >
                <ul class="monitor-add-agent-list">
                  <For each={candidates()}>
                    {(agent) => (
                      <li class="monitor-add-agent-row">
                        <AgentAvatar
                          class="monitor-add-agent-avatar"
                          agent={{
                            avatarSeed: agent.avatarSeed,
                            avatarHue: agent.avatarHue,
                            avatarUrl: agent.avatarUrl,
                          }}
                        />
                        <div class="monitor-add-agent-text">
                          <span class="monitor-add-agent-name">{agent.name}</span>
                          <span class="monitor-add-agent-role">{agent.description}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy() !== null}
                          onClick={() => void add(agent.id)}
                        >
                          {t("monitor.addAgent.add")}
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={error()}>{(message) => <p class="monitor-add-agent-error">{message()}</p>}</Show>
            </div>
            <footer class="monitor-add-agent-footer">
              <Button type="button" variant="ghost" onClick={() => monitor.closeAddAgent()}>
                {t("monitor.addAgent.done")}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
