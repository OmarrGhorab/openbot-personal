import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messages as ar } from "../../../../../packages/i18n/src/messages/ar/composer";
import { messages as en } from "../../../../../packages/i18n/src/messages/en/composer";

describe("ticket 252: the first-run composer links to provider setup", () => {
  it("has the hint and the action in English and Arabic", () => {
    for (const key of ["composer.setup.hint", "composer.setup.action"] as const) {
      expect(JSON.stringify(en)).toContain(`"${key}":"`);
      expect(JSON.stringify(ar)).toContain(`"${key}":"`);
    }
  });
  it("renders the Set up a provider button only when no agent is ready", () => {
    const source = readFileSync(join(__dirname, "ConversationComposer.tsx"), "utf8");
    expect(source).toContain("!agentReady() && !props.agentsConnecting && !props.runtime && props.onSetUpProvider");
    const workspace = readFileSync(join(__dirname, "WorkspaceConversation.tsx"), "utf8");
    expect(workspace).toContain('openServerSettings(server.id, null, "providers")');
  });
});
