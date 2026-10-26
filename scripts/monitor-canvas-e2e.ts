// Checks the Monitor channel canvas in this worktree's running dev app. Start the app with
// `bun run dev` (never `--shared`), then run `bun run test:monitor-canvas -- --allow-mutations`.
// It needs two visible agents on a known provider; it starts no provider turn.
//
// It makes a channel with two agents, opens the Monitor page from the rail, opens the channel, and
// checks that the canvas shows one card per agent of the snapshot. Then it checks the keyboard: an
// arrow key moves the focus from one card to the other, and Enter selects the focused card. It also
// checks that a new snapshot does not move a card. It deletes its channel at the end.
// Writes .openbot-build/monitor-canvas.png and .openbot-build/monitor-canvas-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { MonitorSnapshot } from "@openbot/contracts/ipc";
import { en } from "@openbot/i18n";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

interface Report {
  channelId?: string;
  cards?: string[];
  focusedAfterArrow?: string | null;
  selectedAfterEnter?: string[];
  stableAfterChange?: boolean;
  screenshot?: string;
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("monitor-canvas-e2e");
const { page } = session;
const client = new ChannelClient(page);

const readSnapshot = (channelId: string): Promise<MonitorSnapshot> =>
  page.evaluate((id) => window.openbot.monitor.getSnapshot({ channelId: id }), channelId);
const cards = () =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-monitor-node]")].map((node) => node.dataset.monitorNode ?? ""),
  );
const places = () =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-monitor-node]")].map((node) => [
        node.dataset.monitorNode ?? "",
        `${node.style.getPropertyValue("--monitor-node-x")},${node.style.getPropertyValue("--monitor-node-y")}`,
      ]),
    ),
  );

try {
  const agents = (await client.agents()).slice(0, 2);
  assert.equal(agents.length, 2, "The canvas E2E needs two visible agents on a known provider.");
  const [lead, member] = agents;
  assert.ok(lead && member);
  const name = `monitor-canvas-e2e-${Date.now()}`;
  const channel = await client.create(name, [lead.id, member.id], lead.id);
  report.channelId = channel.id;
  const snapshot = await readSnapshot(channel.id);

  await page.getByRole("button", { name: en["app.rail.monitor"], exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  const shown = await waitFor(
    page,
    "one canvas card per agent of the channel",
    cards,
    (ids) => ids.length === snapshot.agents.length,
  );
  report.cards = shown;
  assert.deepEqual(new Set(shown), new Set(snapshot.agents.map((agent) => agent.id)));

  // The lead has no hand-off yet, so both cards share the first column: Down moves between them.
  const first = shown[0];
  assert.ok(first);
  await page.locator(`[data-monitor-node="${first}"] button`).focus();
  const before = await places();
  for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"]) {
    await page.keyboard.press(key);
    const focused = await page.evaluate(
      () => document.activeElement?.closest<HTMLElement>("[data-monitor-node]")?.dataset.monitorNode ?? null,
    );
    if (focused && focused !== first) {
      report.focusedAfterArrow = focused;
      break;
    }
  }
  assert.ok(report.focusedAfterArrow, "No arrow key moved the focus to the other card.");
  await page.keyboard.press("Enter");
  report.selectedAfterEnter = await waitFor(
    page,
    "the focused card is selected",
    () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[data-monitor-node]")]
          .filter((node) => node.querySelector("button[aria-pressed='true']"))
          .map((node) => node.dataset.monitorNode ?? ""),
      ),
    (ids) => ids.length === 1,
  );
  assert.deepEqual(report.selectedAfterEnter, [report.focusedAfterArrow]);

  // A channel change sends a new snapshot; the cards keep their places.
  await client.command({
    type: "save",
    operationId: crypto.randomUUID(),
    channelId: channel.id,
    draft: {
      name,
      title: "Canvas check",
      instructions: channel.instructions,
      members: [{ agentId: lead.id }, { agentId: member.id }],
      leadAgentId: lead.id,
    },
  });
  await waitFor(
    page,
    "a newer snapshot",
    () => readSnapshot(channel.id),
    (next) => next.revision > snapshot.revision,
  ).catch(() => null);
  report.stableAfterChange = JSON.stringify(await places()) === JSON.stringify(before);
  assert.ok(report.stableAfterChange, "A card moved after a new snapshot.");

  const out = resolve(import.meta.dirname, "../.openbot-build");
  mkdirSync(out, { recursive: true });
  report.screenshot = resolve(out, "monitor-canvas.png");
  await page.screenshot({ path: report.screenshot });
  report.passed = true;
  process.stdout.write(`Wrote ${report.screenshot}\n`);
} finally {
  await client.cleanup();
  process.stdout.write(`Wrote ${writeReport("monitor-canvas-e2e", report)}\n`);
  await session.close();
}
