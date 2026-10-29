import type { InstanceTransferSecretSection } from "@openbot/contracts/ipc";

/**
 * Where the re-sign-in after a copy takes the user. Connectors live in Marketplace › Apps, not in
 * Server settings, so a connector opens the Marketplace; providers and MCP keep their sections.
 */
export function copySetupReauthDestination(section: InstanceTransferSecretSection) {
  return section === "connectors"
    ? ({ kind: "marketplace-apps" } as const)
    : ({ kind: "server-settings", section } as const);
}
