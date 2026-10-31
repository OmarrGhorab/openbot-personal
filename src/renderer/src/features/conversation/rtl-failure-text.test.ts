import { readFileSync } from "node:fs";
import { join } from "node:path";
import { localizeSourceText, sourceText } from "@openbot/i18n/source";
import { describe, expect, it } from "vitest";

const ui = (path: string) => readFileSync(join(__dirname, "../../../../../packages/ui/src/features", path), "utf8");

// #258: failure text that the host stores in English reads in Arabic, and Latin names in an RTL
// screen keep their own direction so they shorten at their logical end.
describe("Arabic failure text and Latin names", () => {
  it("has an Arabic line for the generic task failure, ending on the Arabic side", () => {
    const english = sourceText("error.backend.channelTaskFailed");
    const arabic = localizeSourceText(english, "ar");
    expect(arabic).not.toBe(english);
    expect(arabic).toMatch(/[\u0600-\u06FF]/u);
  });

  it("translates a failed task's stored error in the task panel", () => {
    expect(ui("conversation/AgentTasks.tsx")).toContain("sourceText(task().error");
  });

  it("isolates agent names and ticket titles", () => {
    expect(ui("sidebar/SidebarAgentRow.tsx")).toContain('<strong dir="auto">{rowProps.agent.name}</strong>');
    const board = ui("tickets/TicketsBoard.tsx");
    for (const name of ["tickets-chip-name", "tickets-card-title", "tickets-card-agent-name", "tickets-lane-name"]) {
      expect(board).toContain(`class="${name}" dir="auto"`);
    }
    expect(ui("tickets/TicketDrawer.tsx")).toContain('class="ticket-drawer-title" dir="auto"');
  });
});
