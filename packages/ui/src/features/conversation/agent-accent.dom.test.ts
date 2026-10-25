import { describe, expect, it } from "vitest";
import { agentAccent, agentAccentStyle, agentAccentTone, contrastRatio, relativeLuminance } from "./agent-accent";

describe("agent accent", () => {
  it("measures WCAG luminance and contrast", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("#000000")).toBeCloseTo(0);
    expect(contrastRatio(1, 0)).toBeCloseTo(21);
  });

  it("puts light text on saturated colours and dark text on pale ones", () => {
    expect(agentAccentTone("#7c3aed")).toBe("light");
    expect(agentAccentTone("#dc2626")).toBe("light");
    expect(agentAccentTone("#fde047")).toBe("dark");
    expect(agentAccentTone("#f5f5f5")).toBe("dark");
  });

  it("takes the colour from the agent's seed and hue, and none without an agent", () => {
    const accent = agentAccent({ avatarSeed: "worker-engineer", avatarHue: null });
    expect(accent?.color).toMatch(/^#[\da-f]{6}$/iu);
    expect(agentAccent({ avatarSeed: "worker-engineer" })).toEqual(accent);
    expect(agentAccent(undefined)).toBeUndefined();
    expect(agentAccentStyle(undefined)).toBe("");
    expect(agentAccentStyle(accent)).toContain("--agent-accent:");
  });
});
