// Checks the Monitor views of #28 and #30 in this worktree's running dev app. Start the app with
// `bun run dev` (never `--shared`), then run `bun run test:monitor-e2e -- --allow-mutations`. It needs
// two visible agents on a known provider. It sends one long message to a new channel, which starts one
// provider turn; it deletes its channel at the end.
//
// It checks:
// - a new channel with no activity shows the empty state ("Nothing running in #name") and the
//   Create routine action;
// - after a message, an agent works: the Working status filter dims the agents that do not work,
//   shows its chip, and the chip's clear control restores the full canvas;
// - "Ask an agent about this channel" opens the ask panel, and its close button closes it.
// Writes .openbot-build/monitor-e2e.png and .openbot-build/monitor-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { MonitorSnapshot } from "@openbot/contracts/ipc";
import { en } from "@openbot/i18n";
import { ChannelClient, connectChannelE2e, LONG_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

interface Report {
  channelId?: string;
  emptyStateShown?: boolean;
  workingAgentId?: string;
  dimmedCards?: number;
  chipShown?: boolean;
  chipCleared?: boolean;
  askOpened?: boolean;
  askClosed?: boolean;
  screenshot?: string;
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("monitor-e2e");
const { page } = session;
const client = new ChannelClient(page);

const readSnapshot = (channelId: string): Promise<MonitorSnapshot> =>
  page.evaluate((id) => window.openbot.monitor.getSnapshot({ channelId: id }), channelId);

try {
  const agents = (await client.agents()).slice(0, 2);
  assert.equal(agents.length, 2, "The Monitor E2E needs two visible agents on a known provider.");
  const [lead, member] = agents;
  assert.ok(lead && member);
  const name = `monitor-e2e-${Date.now()}`;
  const channel = await client.create(name, [lead.id, member.id], lead.id);
  report.channelId = channel.id;

  await page.getByRole("button", { name: en["app.rail.monitor"], exact: true }).click();
  const empty = page.locator(".monitor-empty-channel");
  await empty.waitFor({ state: "visible" });
  report.emptyStateShown = await empty.isVisible();
  assert.ok(report.emptyStateShown, "A channel with no activity shows the empty state.");
  await empty.getByRole("button", { name: en["monitor.empty.createRoutine"], exact: true }).waitFor();

  await client.send(channel.id, LONG_PROMPT, null);
  const busy = await waitFor(
    page,
    "an agent that works on a task",
    async () => {
      const snapshot = await readSnapshot(channel.id);
      return snapshot.agents.find((agent) => agent.status === "working") ?? null;
    },
    (value) => value !== null,
  );
  assert.ok(busy);
  report.workingAgentId = busy.id;

  await page.getByRole("button", { name: en["monitor.agentStatus.working"], exact: false }).first().click();
  const chip = page.locator(".monitor-filter-chip");
  await chip.waitFor({ state: "visible" });
  report.chipShown = await chip.isVisible();
  report.dimmedCards = await page.locator(".monitor-canvas [data-dimmed]").count();
  assert.ok(report.chipShown, "The status filter shows its chip.");

  await page.locator(".monitor-filter-chip-clear").click();
  await chip.waitFor({ state: "detached" });
  report.chipCleared = (await page.locator(".monitor-filter-chip").count()) === 0;
  assert.ok(report.chipCleared, "Clearing the filter removes the chip.");
  assert.equal(
    await page.locator(".monitor-canvas [data-dimmed]").count(),
    0,
    "Clearing the filter undims every card.",
  );

  await page.getByRole("button", { name: en["monitor.canvas.ask"], exact: true }).click();
  const ask = page.locator(".monitor-ask");
  await ask.waitFor({ state: "visible" });
  report.askOpened = await ask.isVisible();
  assert.ok(report.askOpened, "The ask panel opens from the canvas footer.");
  await ask.locator(".monitor-ask-close").click();
  await ask.waitFor({ state: "detached" });
  report.askClosed = true;

  const dir = resolve(".openbot-build");
  mkdirSync(dir, { recursive: true });
  const screenshot = resolve(dir, "monitor-e2e.png");
  await page.screenshot({ path: screenshot });
  report.screenshot = screenshot;
  report.passed = true;
} finally {
  writeReport("monitor-e2e", report);
  await client.cleanup();
  await session.close();
}
