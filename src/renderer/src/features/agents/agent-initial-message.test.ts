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
});
