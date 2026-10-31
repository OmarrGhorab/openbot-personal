import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, path), "utf8");
const header = read("ConversationHeader.tsx");
const composer = read("ConversationComposer.tsx");
const hook = read("agent-model-picker.ts");
const css = read("../../../../../packages/ui/src/features/conversation/styles/composer.css");

// #233: the model and effort picker moved from the chat header into the composer, next to +.
describe("model picker in the composer", () => {
  it("is no longer passed to the header", () => {
    expect(header).not.toContain("modelPicker=");
  });

  it("renders right after the + menu, for the chat's agent", () => {
    const plusMenuEnd = composer.indexOf("</DropdownMenu.Root>");
    const picker = composer.indexOf("<ProviderModelPicker {...agentModelPicker()} />");
    const primary = composer.indexOf('<div class="composer-primary-actions">');
    expect(plusMenuEnd).toBeGreaterThan(0);
    expect(picker).toBeGreaterThan(plusMenuEnd);
    expect(picker).toBeLessThan(primary);
  });

  it("keeps the same writes and opens upwards in compact form", () => {
    expect(hook).toContain("inComposer: true");
    expect(hook).toContain(
      "onChange: (model, provider, accountId) => void selectAndConfirmModel(model, provider, accountId)",
    );
    expect(hook).toContain("onReasoningEffortChange: (effort) => void selectAndConfirmReasoning(effort)");
    expect(css).toMatch(/\.provider-model-picker-composer \.provider-model-trigger \{[^}]*max-width: 224px;/);
    expect(css).toContain("grid-template-columns: 28px auto minmax(0, 1fr) auto;");
  });
});
