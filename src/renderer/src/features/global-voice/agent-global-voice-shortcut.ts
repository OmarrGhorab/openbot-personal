import type { GlobalVoiceShortcutStatus, GlobalVoiceState } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createStore, snapshot } from "solid-js";

/** The agent settings' view of one agent's direct global shortcut. */
export interface AgentGlobalVoiceShortcutView {
  accelerator: string | null;
  status: GlobalVoiceShortcutStatus | undefined;
  /** Whether the global shortcuts are on at all. Off, the agent shortcut does nothing either. */
  enabled: boolean;
  onChange: (accelerator: string | null) => void;
}

/**
 * The direct shortcut of one agent, kept in the global voice preference. It reads the preference when
 * the agent changes, and saves the whole preference with this agent's entry replaced.
 */
export function createAgentGlobalVoiceShortcut(agentId: () => string | undefined) {
  const [state, setState] = createStore<{ value: GlobalVoiceState | null }>({ value: null });
  let loadedFor: string | undefined;

  function load(id: string | undefined): void {
    loadedFor = id;
    if (!id) return;
    void window.openbot.globalVoice
      .getState()
      .then((value) => {
        if (loadedFor === id)
          setState((draft) => {
            draft.value = value;
          });
      })
      .catch(() => {
        // The shortcut row stays empty; the settings page reports the failure.
      });
  }

  load(agentId());

  function view(): AgentGlobalVoiceShortcutView | undefined {
    const id = agentId();
    const current = state.value;
    if (!id || !current || loadedFor !== id) return undefined;
    const entry = current.preference.agentShortcuts.find((shortcut) => shortcut.agentId === id);
    const status = current.shortcuts.find(
      (shortcut) => shortcut.target.type === "agent" && shortcut.target.agentId === id,
    )?.status;
    return {
      accelerator: entry?.accelerator ?? null,
      status,
      enabled: current.preference.enabled,
      onChange: (accelerator) => void save(id, accelerator),
    };
  }

  async function save(id: string, accelerator: string | null): Promise<void> {
    const live = state.value;
    if (!live) return;
    // A store value is a proxy that IPC cannot clone; work on a plain copy.
    const current = snapshot(live);
    const others = current.preference.agentShortcuts.filter((shortcut) => shortcut.agentId !== id);
    const agentShortcuts = accelerator ? [...others, { agentId: id, accelerator }] : others;
    try {
      const next = await window.openbot.globalVoice.setPreference({
        ...current.preference,
        agentShortcuts,
      });
      if (agentId() === id)
        setState((draft) => {
          draft.value = next;
        });
    } catch (error) {
      const { t, errorMessage } = currentText();
      toast.error(errorMessage(error, t("globalVoice.agent.saveFailed")), {
        report: { operation: "settings", source: "system", cause_code: "unknown" },
      });
    }
  }

  return {
    view,
    /** Loads the preference again, for an agent whose shortcut the user changed elsewhere. */
    reload: () => load(agentId()),
  };
}
