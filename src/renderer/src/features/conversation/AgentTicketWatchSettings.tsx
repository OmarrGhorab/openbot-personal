// The ticket source of one agent: the repository and label that the ticket intake watches.

import type { AgentTicketWatch } from "@openbot/contracts/ipc";
import { Button, Input, Switch, Text } from "@openbot/ui";
import {
  SettingsField,
  SettingsLinkGroup,
  SettingsPanelContent,
  SettingsPanelHeader,
} from "@openbot/ui/components/SettingsPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show } from "solid-js";
import type { TicketWatchPort } from "./ticket-watch-port";

interface AgentTicketWatchSettingsProps {
  agentId: string;
  port: TicketWatchPort;
  onBack: () => void;
  /** Closes the whole settings panel, as the forward button of every settings page does. */
  onClose: () => void;
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

  // The same frame as the other agent settings pages: header, a muted note, inset rows and fields.
  return (
    <div class="agent-routines-settings agent-ticket-watch">
      <SettingsPanelHeader
        title={t("agentSettings.ticketSource.title")}
        onBack={() => props.onBack()}
        backLabel={t("common.back")}
        onClose={() => props.onClose()}
        closeLabel={t("agentSettings.closeDetails")}
      />
      <SettingsPanelContent>
        <div class="agent-settings-page">
          <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
            {t("agentSettings.ticketSource.description")}
          </Text>
          <SettingsLinkGroup inset class="agent-settings-runtime-rows">
            <div class="agent-settings-switch-row">
              <span class="settings-link-label">{t("agentSettings.ticketSource.provider")}</span>
              <span class="agent-ticket-watch-provider">{t("agentSettings.ticketSource.github")}</span>
            </div>
            <div class="agent-settings-switch-row">
              <span class="settings-link-label">{t("agentSettings.ticketSource.enabled")}</span>
              <Switch
                size="sm"
                aria-label={t("agentSettings.ticketSource.enabled")}
                checked={enabled()}
                disabled={busy()}
                onChange={(checked) => setEnabled(checked)}
              />
            </div>
          </SettingsLinkGroup>
          <SettingsField label={t("agentSettings.ticketSource.project")}>
            <Input
              value={project()}
              placeholder={t("agentSettings.ticketSource.projectHelp")}
              disabled={busy()}
              onInput={(event) => setProject(event.currentTarget.value)}
            />
          </SettingsField>
          <SettingsField label={t("agentSettings.ticketSource.label")}>
            <Input value={label()} disabled={busy()} onInput={(event) => setLabel(event.currentTarget.value)} />
          </SettingsField>
          <Show when={error()}>
            {(message) => (
              <p role="alert" class="agent-settings-save-error">
                {message()}
              </p>
            )}
          </Show>
          <div class="agent-ticket-watch-actions">
            <Show when={saved()}>
              <Button variant="ghost" type="button" disabled={busy()} onClick={() => void remove()}>
                {t("agentSettings.ticketSource.remove")}
              </Button>
            </Show>
            <Button type="button" disabled={busy() || !project().trim() || !label().trim()} onClick={() => void save()}>
              {t("agentSettings.ticketSource.save")}
            </Button>
          </div>
        </div>
      </SettingsPanelContent>
    </div>
  );
}
