import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(__dirname, "../../../../../packages/ui/src/features/tickets/TicketsPage.tsx"), "utf8");
const header = page.slice(page.indexOf('<header class="tickets-page-header">'), page.indexOf("</header>"));

describe("ticket 253: the Tickets title row", () => {
  it("keeps the stats out of the title row", () => {
    expect(header).not.toContain("TicketsSummaryLine");
    expect(page.slice(page.indexOf("</header>"))).toContain("TicketsSummaryLine");
  });
  it("cuts a long title with an ellipsis", () => {
    const css = readFileSync(join(__dirname, "../../../../../packages/ui/src/features/tickets/tickets.css"), "utf8");
    expect(css).toMatch(/\.tickets-page-header h2 \{\s*overflow: hidden;\s*text-overflow: ellipsis;/u);
  });
  it("hides the server name in the window title row", () => {
    const windowCss = readFileSync(join(__dirname, "../window/window.css"), "utf8");
    expect(windowCss).toContain(".tickets-page-header h2 > span {");
    expect(windowCss).toContain("inset-inline-start: var(--left-panel-width);");
  });
});
