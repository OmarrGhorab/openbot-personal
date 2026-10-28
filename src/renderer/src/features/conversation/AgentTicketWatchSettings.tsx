// The ticket source of one agent: the repository and label that the ticket intake watches.

import type { AgentTicketWatch } from "@openbot/contracts/ipc";
import { Button, Input, SwitchField } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show } from "solid-js";
import type { TicketWatchPort } from "./ticket-watch-port";

interface AgentTicketWatchSettingsProps {
  agentId: string;
  port: TicketWatchPort;
  onBack: () => void;
  onChanged: (watch: AgentTicketWatch | null) => void;
}

export function AgentTicketWatchSettings(props: AgentTicketWatchSettingsProps) {
  const text = useText();
  const { t, errorMessage } = text;
  const [project, setProject] = createSignal("");
  const [label, setLabel] = createSignal("agent");
  const [enabled, setEnabled] = createSignal(true);
  const [saved, setSaved] = createSignal<AgentTicketWatch | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(
    () => props.agentId,
    (agentId) => {
      props.port
        .read(agentId)
        .then((watch) => {
          setSaved(watch);
          if (!watch) return;
          setProject(watch.project);
          setLabel(watch.label);
          setEnabled(watch.enabled);
        })
        .catch((caught: unknown) => setError(errorMessage(caught, t("agentSettings.ticketSource.loadFailed"))));
    },
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const watch = await props.port.save({
        agentId: props.agentId,
        provider: "github",
        project: project().trim(),
        label: label().trim(),
        enabled: enabled(),
      });
      setSaved(watch);
      props.onChanged(watch);
    } catch (caught) {
      setError(errorMessage(caught, t("agentSettings.ticketSource.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.port.remove(props.agentId);
      setSaved(null);
      props.onChanged(null);
    } catch (caught) {
      setError(errorMessage(caught, t("agentSettings.ticketSource.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="agent-ticket-watch">
      <header>
        <Button variant="ghost" type="button" onClick={() => props.onBack()}>
          {t("common.back")}
        </Button>
        <h2>{t("agentSettings.ticketSource.title")}</h2>
      </header>
      <p>{t("agentSettings.ticketSource.description")}</p>
      <p>
        {t("agentSettings.ticketSource.provider")}: {t("agentSettings.ticketSource.github")}
      </p>
      <label>
        <span>{t("agentSettings.ticketSource.project")}</span>
        <Input
          value={project()}
          placeholder={t("agentSettings.ticketSource.projectHelp")}
          disabled={busy()}
          onInput={(event) => setProject(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>{t("agentSettings.ticketSource.label")}</span>
        <Input value={label()} disabled={busy()} onInput={(event) => setLabel(event.currentTarget.value)} />
      </label>
      <SwitchField
        label={t("agentSettings.ticketSource.enabled")}
        checked={enabled()}
        disabled={busy()}
        onChange={(checked) => setEnabled(checked)}
      />
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <div>
        <Button type="button" disabled={busy() || !project().trim() || !label().trim()} onClick={() => void save()}>
          {t("agentSettings.ticketSource.save")}
        </Button>
        <Show when={saved()}>
          <Button variant="ghost" type="button" disabled={busy()} onClick={() => void remove()}>
            {t("agentSettings.ticketSource.remove")}
          </Button>
        </Show>
      </div>
    </section>
  );
}
