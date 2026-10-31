import { describe, expect, it } from "vitest";
import { newAgentInput } from "./agent-create-input";

describe("new agent role (ticket 259)", () => {
  it("saves the role as the description and does not post it as a message", () => {
    const input = newAgentInput(
      { name: " Developer ", purpose: "Implement code changes and run tests.", avatarSeed: "s", avatarHue: 0 },
      true,
    );
    expect(input.description).toBe("Implement code changes and run tests.");
    expect(input.initialMessage).toBe("Greet me briefly.");
    expect(input.initialMessage).not.toContain("Your ongoing role is");
  });

  it("sends the chosen effort with the model to a local host only", () => {
    const draft = {
      name: "Dev",
      purpose: "",
      avatarSeed: "s",
      avatarHue: 0,
      provider: "codex",
      model: "gpt-5.5",
      reasoningEffort: "high",
    } as const;
    expect(newAgentInput(draft, true, true)).toMatchObject({ provider: "codex", reasoningEffort: "high" });
    expect(newAgentInput(draft, true, false)).not.toHaveProperty("reasoningEffort");
    expect(newAgentInput({ ...draft, reasoningEffort: undefined }, true, true)).not.toHaveProperty("reasoningEffort");
  });
});
