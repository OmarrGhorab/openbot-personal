import { describe, expect, it } from "vitest";
import { matchAgentAddress } from "./global-voice-agent-address";

const agents = [
  { agentId: "worker", name: "Worker Engineer", title: "Builds features" },
  { agentId: "software", name: "Software Engineer", title: "Reviews code" },
  { agentId: "designer", name: "مصمم", title: "Designs screens" },
];

describe("matchAgentAddress", () => {
  it("routes an English address and strips it", () => {
    expect(matchAgentAddress("Software Engineer, check the PR", agents)).toEqual({
      agentId: "software",
      text: "check the PR",
    });
    expect(matchAgentAddress("hey worker engineer: run the tests", agents)).toEqual({
      agentId: "worker",
      text: "run the tests",
    });
    expect(matchAgentAddress("Tell Software Engineer to merge it", agents)?.agentId).toBe("software");
  });

  it("tolerates speech-to-text misspellings", () => {
    expect(matchAgentAddress("Softwear Enginer check the PR", agents)?.agentId).toBe("software");
    expect(matchAgentAddress("walker engineer fix the build", agents)?.agentId).toBe("worker");
  });

  it("routes an Arabic address, and an English name heard in Arabic letters", () => {
    expect(matchAgentAddress("يا مصمم، غير لون الزر", agents)).toEqual({ agentId: "designer", text: "غير لون الزر" });
    expect(matchAgentAddress("سوفتوير انجنير راجع الطلب", agents)).toEqual({
      agentId: "software",
      text: "راجع الطلب",
    });
  });

  it("keeps the current target when no name is heard, or when the name is not at the start", () => {
    expect(matchAgentAddress("check the PR please", agents)).toBeUndefined();
    expect(matchAgentAddress("please check what Software Engineer did", agents)).toBeUndefined();
    expect(matchAgentAddress("Software Engineer", agents)).toBeUndefined();
  });

  it("does not guess between two agents that match as well", () => {
    expect(matchAgentAddress("engineer check the PR", agents)).toBeUndefined();
    const twins = [
      { agentId: "a", name: "Helper" },
      { agentId: "b", name: "Helper" },
    ];
    expect(matchAgentAddress("helper do it", twins)).toBeUndefined();
  });
});
