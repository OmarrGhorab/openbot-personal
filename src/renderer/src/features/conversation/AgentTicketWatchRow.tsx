// The row of the agent settings that opens the ticket source. It shows the watched repository on the right.

import type { AgentTicketWatch } from "@openbot/contracts/ipc";
import { ListChecks } from "@openbot/ui";
import { SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show } from "solid-js";
import { AgentTicketWatchSettings } from "./AgentTicketWatchSettings";
import { agentTicketWatchPort } from "./ticket-watch-port";

export function AgentTicketWatchRow(props: { agentId: string; onClose: () => void }) {
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

  // A saved source names its repository and label even when it is switched off. The name may be cut
  // with an ellipsis, so the off state is a separate part that always shows.
  const summary = () => {
    const current = watch();
    if (!current) return t("agentSettings.links.ticketSourceOff");
    return (
      <>
        <span class="agent-ticket-watch-summary">
          {t("agentSettings.links.ticketSourceWatching", { project: current.project, label: current.label })}
        </span>
        <Show when={!current.enabled}>
          <span class="agent-ticket-watch-off">{t("agentSettings.links.ticketSourceOffSuffix")}</span>
        </Show>
      </>
    );
  };

  return (
    <>
      <SettingsLinkRow
        icon={<ListChecks aria-hidden="true" />}
        label={t("agentSettings.links.ticketSource")}
        class="agent-ticket-watch-link"
        value={summary()}
        onClick={() => setOpen(true)}
      />
      <Show when={open()}>
        <div class="agent-routines-overlay">
          <AgentTicketWatchSettings
            agentId={props.agentId}
            port={port}
            onBack={() => setOpen(false)}
            onClose={() => {
              setOpen(false);
              props.onClose();
            }}
            onChanged={setWatch}
          />
        </div>
      </Show>
    </>
  );
}
