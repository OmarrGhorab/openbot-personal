import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGED_SKILL_SLUGS, TICKET_FACTORY_SKILL_SLUG } from "./managed-skill-service";

const skill = readFileSync(join(__dirname, "../../resources/managed-skills/ticket-factory/SKILL.md"), "utf8");

describe("ticket 243: the ticket-factory skill", () => {
  it("ships as a managed skill in every agent workspace", () => {
    expect(MANAGED_SKILL_SLUGS.has(TICKET_FACTORY_SKILL_SLUG)).toBe(true);
    expect(skill.startsWith("---\nname: ticket-factory\n")).toBe(true);
  });

  it("names the final ticket tools", () => {
    for (const tool of [
      "update_ticket",
      "attach_ticket_evidence",
      "request_ticket_review",
      "submit_ticket_verdict",
      "open_ticket_pull_request",
    ])
      expect(skill).toContain(`\`${tool}\``);
  });

  it("covers every phase and the house rules", () => {
    for (const phase of ["take", "triage", "reproduce", "implement", "verify", "review", "merge", "report"])
      expect(skill).toContain(`**${phase}**`);
    for (const rule of [
      "GitHub issues only",
      "Jira",
      "Arabic",
      "right to left",
      "real app window",
      "No blue",
      "No visible queue",
    ])
      expect(skill).toContain(rule);
  });
});
