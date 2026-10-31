import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../../../../..");
const css = readFileSync(join(root, "packages/ui/src/features/tickets/tickets.css"), "utf8");
const page = readFileSync(join(root, "packages/ui/src/features/tickets/TicketsPage.tsx"), "utf8");

// The board's columns have to fit beside the open ticket panel (#269). A `:has(> .tickets-side)`
// rule broke the dev CSS build, so the page marks itself instead.
describe("tickets board with the ticket panel open", () => {
  it("marks the page while a ticket is open", () => {
    expect(page).toMatch(/class="tickets-page" data-ticket-open=\{selectedTicket\(\) \? "" : undefined\}/);
  });

  it("shrinks the five columns to a compact width and keeps the panel from growing", () => {
    const rule = css.match(/\.tickets-page\[data-ticket-open\] \.tickets-columns \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("repeat(5, minmax(6.5rem, 1fr))");
    expect(rule).toContain("min-width: calc(5 * 6.5rem");
    expect(css).toMatch(/\.tickets-side \{[^}]*width: min\(26rem, 40%\);[^}]*min-width: 18rem;/);
  });

  it("does not key the layout on a :has() child selector", () => {
    expect(css).not.toMatch(/:has\(\s*>/);
  });
});
