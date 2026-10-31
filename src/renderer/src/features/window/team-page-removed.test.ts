import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../../../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("ticket 242: the Raven team page is gone", () => {
  it("has no page component and no route", () => {
    expect(existsSync(join(root, "packages/ui/src/features/raven-team"))).toBe(false);
    expect(existsSync(join(root, "src/renderer/src/features/raven-team"))).toBe(false);
    expect(read("src/renderer/src/features/window/WindowPageView.tsx")).not.toContain("RavenTeam");
    expect(read("src/renderer/src/features/usage/usage-context.tsx")).not.toContain("openTeam");
  });

  it("has no Tickets toolbar button, drawer action or search command for it", () => {
    expect(read("packages/ui/src/features/tickets/TicketsPage.tsx")).not.toContain("onOpenTeam");
    expect(read("packages/ui/src/features/tickets/TicketDrawer.tsx")).not.toContain("onRunTeam");
    expect(read("src/renderer/src/global-search-sources.ts")).not.toContain('"raven-team"');
    for (const lang of ["en", "ar"]) {
      const tickets = read(`packages/i18n/src/messages/${lang}/tickets.ts`);
      expect(tickets).not.toContain('"tickets.team.open"');
      expect(tickets).not.toContain('"tickets.drawer.runTeam"');
      expect(read(`packages/i18n/src/messages/${lang}/agent.ts`)).not.toContain('"agent.team.open"');
    }
  });
});
