import { type AgentMcpChangesPreference, DEFAULT_AGENT_MCP_CHANGES_PREFERENCE } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { PreferenceStore } from "./preference-file";

/**
 * Whether agents with Full access change the MCP servers of this computer without an approval card.
 * The backend reads it at each MCP change, so turning it off brings the approval back for the next
 * change. A file that is missing, unreadable or without the switch reads as off.
 */
export type AgentMcpChangesPreferenceStore = PreferenceStore<AgentMcpChangesPreference>;

export function createAgentMcpChangesPreferenceStore(path: string): AgentMcpChangesPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_AGENT_MCP_CHANGES_PREFERENCE,
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.withoutApproval)
        ? { withoutApproval: parsed.withoutApproval }
        : null,
  });
}
