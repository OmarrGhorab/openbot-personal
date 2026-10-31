import { matchAgentName, similarAgentNameIds } from "@openbot/contracts/agent-mention-rank";
import { describe, expect, it } from "vitest";

const agents = [
  { id: "a", name: "Raven Reviewer (gemini-3.8-flash)" },
  { id: "b", name: "Reviewer" },
  { id: "c", name: "Raven Builder" },
  { id: "d", name: "Code Reviewer" },
];

describe("matchAgentName", () => {
  it("prefers the exact name over a longer one that contains it", () => {
    expect(matchAgentName(agents, "Reviewer")).toEqual({ kind: "exact", agent: agents[1] });
    expect(matchAgentName(agents, "@reviewer")).toEqual({ kind: "exact", agent: agents[1] });
  });

  it("asks when several names contain the query and none is exact", () => {
    const match = matchAgentName(agents, "raven");
    expect(match.kind).toBe("ambiguous");
    expect(match.kind === "ambiguous" && match.agents.map((agent) => agent.id)).toEqual(["a", "c"]);
  });

  it("takes a single partial match and reports none for no match", () => {
    expect(matchAgentName(agents, "builder")).toEqual({ kind: "single", agent: agents[2] });
    expect(matchAgentName(agents, "planner")).toEqual({ kind: "none" });
  });
});

describe("similarAgentNameIds", () => {
  it("marks names that are whole words inside another name", () => {
    expect([...similarAgentNameIds(agents)].sort()).toEqual(["a", "b", "d"]);
  });

  it("marks the same name and skips a part of a word", () => {
    const list = [
      { id: "x", name: "Builder" },
      { id: "y", name: "builder" },
      { id: "z", name: "Rebuilder" },
    ];
    expect([...similarAgentNameIds(list)].sort()).toEqual(["x", "y"]);
  });
});
