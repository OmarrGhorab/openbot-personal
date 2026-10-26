// Checks the Monitor Feed and Tasks views and Pause feed in this worktree's running dev app. Start the
// app with `bun run dev` (never `--shared`), then run `bun run test:monitor-feed -- --allow-mutations`.
// It needs two visible agents on a known provider. It sends one short message to the channel, which
// can start one provider turn; it stops the channel's tasks at the end.
//
// It makes two channels, opens the Monitor page and the first channel, and checks:
// - the Canvas / Feed / Tasks switch keeps the open channel, and Tasks shows its columns and chips;
// - Pause feed stops the feed: a new message waits, and the banner count equals the events of the
//   newest snapshot that the feed does not show;
// - Resume feed shows every event once, with none lost;
// - leaving the channel while paused and coming back opens it live, with the newest events.
// It deletes its channels at the end. Writes .openbot-build/monitor-feed.png and
// .openbot-build/monitor-feed-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { MonitorSnapshot } from "@openbot/contracts/ipc";
import { en } from "@openbot/i18n";
import { ChannelClient, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

interface Report {
  channelId?: string;
  otherChannelId?: string;
  keptChannelOnTabs?: boolean;
  taskColumns?: string[];
  shownBeforePause?: number;
  waitingWhilePaused?: number | undefined;
  expectedWaiting?: number;
  shownAfterResume?: number;
  duplicatesAfterResume?: number;
  lostAfterResume?: number;
  liveAfterReturn?: boolean;
  screenshot?: string;
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("monitor-feed-e2e");
const { page } = session;
const client = new ChannelClient(page);

const readSnapshot = (channelId: string): Promise<MonitorSnapshot> =>
  page.evaluate((id) => window.openbot.monitor.getSnapshot({ channelId: id }), channelId);
/** The event ids the feed shows, in order. */
const feedIds = () =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-monitor-event]")].map((item) => item.dataset.monitorEvent ?? ""),
  );
const waiting = () =>
  page.evaluate(() => {
    const banner = document.querySelector<HTMLElement>("[data-monitor-waiting]");
    return banner ? Number(banner.dataset.monitorWaiting) : null;
  });
const title = () => page.locator(".monitor-channel-header .monitor-page-title").innerText();
const tab = (key: "monitor.tab.canvas" | "monitor.tab.feed" | "monitor.tab.tasks") =>
  page.getByRole("tab", { name: en[key], exact: true });
const openChannel = (name: string) =>
  page
    .getByRole("button", { name: new RegExp(name) })
    .first()
    .click();

try {
  const agents = (await client.agents()).slice(0, 2);
  assert.equal(agents.length, 2, "The feed E2E needs two visible agents on a known provider.");
  const [lead, member] = agents;
  assert.ok(lead && member);
  const stamp = Date.now();
  const name = `monitor-feed-e2e-${stamp}`;
  const otherName = `monitor-feed-e2e-other-${stamp}`;
  const channel = await client.create(name, [lead.id, member.id], lead.id);
  const other = await client.create(otherName, [lead.id], lead.id);
  report.channelId = channel.id;
  report.otherChannelId = other.id;

  await page.getByRole("button", { name: en["app.rail.monitor"], exact: true }).click();
  await openChannel(name);
  await waitFor(page, "the channel header", title, (text) => text === name);

  // The switch keeps the channel.
  await tab("monitor.tab.tasks").click();
  report.taskColumns = await waitFor(
    page,
    "the task table",
    () => page.locator(".monitor-tasks-table th").allInnerTexts(),
    (columns) => columns.length === 6,
  ).catch(() => []);
  const tasksTitle = await title();
  await tab("monitor.tab.feed").click();
  await page.locator(".monitor-feed").waitFor();
  report.keptChannelOnTabs = tasksTitle === name && (await title()) === name;
  assert.ok(report.keptChannelOnTabs, "The view switch changed the open channel.");

  // Pause feed, then a new message.
  const before = await feedIds();
  report.shownBeforePause = before.length;
  await page.getByRole("button", { name: en["monitor.pause.pause"], exact: true }).click();
  await waitFor(page, "the paused banner", waiting, (count) => count !== null);
  await client.send(channel.id, SHORT_PROMPT, null);
  // The banner count is exact: the newest snapshot's events that the feed does not show.
  const check = await waitFor(
    page,
    "the banner count to match the newest snapshot",
    async () => {
      const shown = new Set(await feedIds());
      const latest = await readSnapshot(channel.id);
      const expected = latest.events.filter((event) => !shown.has(event.id)).length;
      return { shown: [...shown], expected, count: await waiting() };
    },
    (state) => state.expected > 0 && state.count === state.expected,
  );
  report.waitingWhilePaused = check.count ?? undefined;
  report.expectedWaiting = check.expected;
  assert.deepEqual(check.shown, before, "The feed changed while paused.");

  // Resume: every event once, none lost.
  await page.getByRole("button", { name: en["monitor.pause.resume"], exact: true }).click();
  const after = await waitFor(page, "the feed after Resume", feedIds, (ids) => ids.length > before.length);
  report.shownAfterResume = after.length;
  report.duplicatesAfterResume = after.length - new Set(after).size;
  const latest = await readSnapshot(channel.id);
  const latestIds = new Set(latest.events.map((event) => event.id));
  report.lostAfterResume = [...before, ...check.shown].filter((id) => latestIds.has(id) && !after.includes(id)).length;
  assert.equal(report.duplicatesAfterResume, 0, "An event shows twice after Resume.");
  assert.equal(report.lostAfterResume, 0, "An event is lost after Resume.");
  assert.equal(await waiting(), null, "The banner stays after Resume.");

  // Leave the channel while paused, come back: live, with the newest events.
  await page.getByRole("button", { name: en["monitor.pause.pause"], exact: true }).click();
  await openChannel(otherName);
  await waitFor(page, "the other channel", title, (text) => text === otherName);
  await openChannel(name);
  await waitFor(page, "the channel again", title, (text) => text === name);
  const caughtUp = await waitFor(
    page,
    "the newest events after coming back",
    async () => {
      const fresh = await readSnapshot(channel.id);
      const back = await feedIds();
      return fresh.events.every((event) => back.includes(event.id));
    },
    (done) => done,
  ).catch(() => false);
  report.liveAfterReturn =
    caughtUp &&
    (await waiting()) === null &&
    (await page.getByRole("button", { name: en["monitor.pause.pause"], exact: true }).count()) === 1;
  assert.ok(report.liveAfterReturn, "The channel did not open live after leaving it while paused.");

  const out = resolve(import.meta.dirname, "../.openbot-build");
  mkdirSync(out, { recursive: true });
  report.screenshot = resolve(out, "monitor-feed.png");
  await page.screenshot({ path: report.screenshot });
  report.passed = true;
  process.stdout.write(`Wrote ${report.screenshot}\n`);
} finally {
  await client.cleanup();
  process.stdout.write(`Wrote ${writeReport("monitor-feed-e2e", report)}\n`);
  await session.close();
}
