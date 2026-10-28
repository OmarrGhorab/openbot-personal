import type { AgentMcpChangesPreference, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { Alert, AlertContent, AlertDescription, SwitchField } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onMount, Show } from "solid-js";
import { actionToast } from "../../action-toast";

/** The calls of the setting. The desktop reaches them through main; a story passes its own. */
export type McpApprovalCalls = Pick<OpenBotDesktopApi, "getAgentMcpChangesPreference" | "setAgentMcpChangesPreference">;

/**
 * Server Settings > MCP, on this computer only: whether agents with Full access add, change, turn on
 * or off and remove MCP servers without an approval card. Off by default, with the warning always
 * visible. Off asks again from the next change and keeps the servers that agents added.
 */
export function ServerMcpApprovalSetting(props: { disabled: boolean; calls?: McpApprovalCalls }) {
  const { t, errorMessage } = useText();
  const calls = (): McpApprovalCalls => props.calls ?? window.openbot;
  const [preference, setPreference] = createSignal<AgentMcpChangesPreference | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  onMount(() => {
    calls()
      .getAgentMcpChangesPreference()
      .then(setPreference, (error: unknown) => setLoadError(errorMessage(error, t("mcp.changes.loadFailed"))));
  });

  async function change(withoutApproval: boolean): Promise<void> {
    if (saving() || preference()?.withoutApproval === withoutApproval) return;
    setSaving(true);
    try {
      setPreference(await calls().setAgentMcpChangesPreference({ withoutApproval }));
    } catch (error) {
      actionToast.error(errorMessage(error, t("mcp.changes.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Show
      when={preference()}
      fallback={
        <Show when={loadError()}>
          {(message) => (
            <Alert tone="warning" role="alert">
              <AlertContent>
                <AlertDescription>{message()}</AlertDescription>
              </AlertContent>
            </Alert>
          )}
        </Show>
      }
    >
      {(current) => (
        <>
          <SwitchField
            checked={current().withoutApproval}
            disabled={props.disabled || saving()}
            onChange={(withoutApproval) => void change(withoutApproval)}
            label={t("mcp.changes.withoutApprovalTitle")}
            description={t("mcp.changes.withoutApprovalDescription")}
          />
          {/* Shown before the switch is turned on too, so the risk is read first. */}
          <Alert tone="warning" report={false}>
            <AlertContent>
              <AlertDescription>{t("mcp.changes.withoutApprovalWarning")}</AlertDescription>
            </AlertContent>
          </Alert>
        </>
      )}
    </Show>
  );
}
