// The row of the agent settings that opens the ticket source. It shows the watched repository on the right.

import type { AgentTicketWatch } from "@openbot/contracts/ipc";
import { ListChecks } from "@openbot/ui";
import { SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show } from "solid-js";
import { AgentTicketWatchSettings } from "./AgentTicketWatchSettings";
import { agentTicketWatchPort } from "./ticket-watch-port";

export function AgentTicketWatchRow(props: { agentId: string }) {
  const { t } = useText();
  const port = agentTicketWatchPort();
  const [watch, setWatch] = createSignal<AgentTicketWatch | null>(null);
  const [open, setOpen] = createSignal(false);

  createEffect(
    () => props.agentId,
    (agentId) => {
      port
        .read(agentId)
        .then(setWatch)
        .catch(() => setWatch(null));
    },
  );

  const summary = () => {
    const current = watch();
    return current
      ? t("agentSettings.links.ticketSourceWatching", { project: current.project, label: current.label })
      : t("agentSettings.links.ticketSourceOff");
  };

  return (
    <>
      <SettingsLinkRow
        icon={<ListChecks aria-hidden="true" />}
        label={t("agentSettings.links.ticketSource")}
        value={summary()}
        onClick={() => setOpen(true)}
      />
      <Show when={open()}>
        <div class="agent-routines-overlay">
          <AgentTicketWatchSettings
            agentId={props.agentId}
            port={port}
            onBack={() => setOpen(false)}
            onChanged={setWatch}
          />
        </div>
      </Show>
    </>
  );
}
