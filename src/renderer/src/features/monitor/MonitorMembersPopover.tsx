import { Button, DropdownMenu, Ellipsis, Popover, Trash2 } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { StatusPill } from "@openbot/ui/features/monitor/StatusPill";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { useChannels } from "../channels/channels-context";
import { useMonitor } from "./monitor-context";
import { MONITOR_AGENT_STATUS_LABEL } from "./monitor-filters";
import { changeChannelMember } from "./monitor-members";

/**
 * The members of the open channel, in a popover under the agent icons of the header. Each member
 * shows its role and status, and a menu removes it from the channel: the agent keeps its thread and
 * identity. Add agent opens the add-agent dialog.
 */
export function MonitorMembersPopover(props: { children: JSX.Element }) {
  const { t } = useText();
  const monitor = useMonitor();
  const channels = useChannels();
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const members = () => monitor.state.snapshot?.agents ?? [];

  async function remove(agentId: string) {
    const channelId = monitor.state.snapshot?.channelId;
    if (!channelId || busy() !== null) return;
    setBusy(agentId);
    setError(null);
    try {
      if (!(await changeChannelMember(channels, channelId, agentId, false))) setError(t("monitor.members.error"));
    } catch {
      setError(t("monitor.members.error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Popover.Root
      open={monitor.state.membersOpen}
      onOpenChange={(open) => (open ? monitor.openMembers() : monitor.closeMembers())}
      placement="bottom-start"
      gutter={6}
    >
      <Popover.Trigger class="monitor-members-trigger" aria-label={t("monitor.members.title")}>
        {props.children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="monitor-members-popover">
          <h2 class="monitor-members-title">{t("monitor.members.title")}</h2>
          <ul class="monitor-members-list">
            <For each={members()}>
              {(agent) => (
                <li class="monitor-members-row">
                  <AgentAvatar
                    class="monitor-members-avatar"
                    agent={{ avatarSeed: agent.avatarSeed, avatarHue: agent.avatarHue, avatarUrl: agent.avatarUrl }}
                  />
                  <div class="monitor-members-text">
                    <span class="monitor-members-name">{agent.name}</span>
                    <span class="monitor-members-role">
                      {agent.lead ? t("monitor.members.lead") : t("monitor.members.member")}
                    </span>
                  </div>
                  <StatusPill status={agent.status} label={t(MONITOR_AGENT_STATUS_LABEL[agent.status])} />
                  <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
                    <DropdownMenu.Trigger
                      class="monitor-members-menu-trigger"
                      aria-label={t("monitor.members.menu", { name: agent.name })}
                    >
                      <Ellipsis aria-hidden="true" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="monitor-members-menu">
                        <DropdownMenu.Item
                          class="ui-action-menu-danger"
                          disabled={busy() !== null}
                          onSelect={() => void remove(agent.id)}
                        >
                          <Trash2 aria-hidden="true" />
                          {t("monitor.members.remove")}
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </li>
              )}
            </For>
          </ul>
          <Show when={error()}>{(message) => <p class="monitor-members-error">{message()}</p>}</Show>
          <Button type="button" variant="ghost" class="monitor-members-add" onClick={() => monitor.openAddAgent()}>
            {t("monitor.members.addAgent")}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
