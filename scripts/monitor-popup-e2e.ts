// Checks the Monitor agent popup in this worktree's running dev app. Start the app with `bun run dev`
// (never `--shared`), then run `bun run test:monitor-popup -- --allow-mutations`. It needs two visible
// agents on a known provider. It sends one long message to the channel, which starts one provider
// turn; it stops the channel's tasks at the end.
//
// It makes a channel, waits until an agent of the channel works on a task, opens the Monitor and the
// channel, and checks:
// - a click on the agent's canvas card opens the popup with the task; Escape closes it;
// - Stop task opens the confirm dialog; Cancel keeps the task; Confirm stops it (the channel task is
//   held), and the agent keeps its id, name, provider and avatar;
// - Resume task continues the held task (its state leaves `paused`);
// - Open thread shows the agent's thread with "Back to monitor", which shows the Monitor again.
// It deletes its channel at the end. Writes .openbot-build/monitor-popup.png and
// .openbot-build/monitor-popup-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { MonitorSnapshot } from "@openbot/contracts/ipc";
import { en } from "@openbot/i18n";
import { ChannelClient, connectChannelE2e, LONG_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

interface Report {
  channelId?: string;
  agentId?: string;
  taskId?: string;
  popupOpened?: boolean;
  escapeClosed?: boolean;
  cancelKeptTask?: boolean;
  stateAfterStop?: string;
  identityKept?: boolean;
  stateAfterResume?: string;
  backToMonitor?: boolean;
  screenshot?: string;
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("monitor-popup-e2e");
const { page } = session;
const client = new ChannelClient(page);

const readSnapshot = (channelId: string): Promise<MonitorSnapshot> =>
  page.evaluate((id) => window.openbot.monitor.getSnapshot({ channelId: id }), channelId);
const popup = () => page.locator(".monitor-popup");
const taskState = async (channelId: string, taskId: string) =>
  (await client.read(channelId)).tasks.find((task) => task.id === taskId)?.state ?? "missing";
const identity = async (agentId: string) => {
  const agent = (await client.agents()).find((entry) => entry.id === agentId);
  return agent ? JSON.stringify([agent.id, agent.name, agent.provider, agent.avatarSeed, agent.avatarHue]) : null;
};

try {
  const agents = (await client.agents()).slice(0, 2);
  assert.equal(agents.length, 2, "The popup E2E needs two visible agents on a known provider.");
  const [lead, member] = agents;
  assert.ok(lead && member);
  const name = `monitor-popup-e2e-${Date.now()}`;
  const channel = await client.create(name, [lead.id, member.id], lead.id);
  report.channelId = channel.id;
  await client.send(channel.id, LONG_PROMPT, null);

  // An agent of the channel works on a channel task.
  const busy = await waitFor(
    page,
    "an agent with a channel task",
    async () => {
      const snapshot = await readSnapshot(channel.id);
      const agent = snapshot.agents.find((entry) => entry.currentTaskId !== null);
      const task = snapshot.tasks.find((entry) => entry.id === agent?.currentTaskId && entry.source === "channel");
      return agent && task ? { agent, task } : null;
    },
    (value) => value !== null,
  );
  assert.ok(busy);
  report.agentId = busy.agent.id;
  report.taskId = busy.task.id;
  const before = await identity(busy.agent.id);

  await page.getByRole("button", { name: en["app.rail.monitor"], exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  const card = page.getByRole("button", { name: en["monitor.node.select"].replace("{name}", busy.agent.name) });

  // Open, then Escape.
  await card.click();
  await popup().waitFor();
  report.popupOpened = (await popup().getByRole("heading", { name: busy.agent.name }).count()) > 0;
  assert.ok(report.popupOpened, "The popup does not name the agent.");
  await page.keyboard.press("Escape");
  await popup().waitFor({ state: "detached" });
  report.escapeClosed = true;

  // Stop: Cancel keeps the task, Confirm holds it.
  await card.click();
  await popup().waitFor();
  const stop = () => popup().getByRole("button", { name: en["monitor.popup.stopTask"], exact: true });
  const confirm = () => page.getByRole("alertdialog");
  await stop().click();
  await confirm().waitFor();
  await confirm().getByRole("button", { name: en["common.cancel"], exact: true }).click();
  await confirm().waitFor({ state: "detached" });
  report.cancelKeptTask = (await taskState(channel.id, busy.task.id)) !== "paused";
  assert.ok(report.cancelKeptTask, "Cancel stopped the task.");
  await stop().click();
  await confirm().getByRole("button", { name: en["monitor.popup.stopTask"], exact: true }).click();
  report.stateAfterStop = await waitFor(
    page,
    "the held task",
    () => taskState(channel.id, busy.task.id),
    (state) => state === "paused",
  );
  report.identityKept = (await identity(busy.agent.id)) === before;
  assert.ok(report.identityKept, "Stop changed the agent.");

  // Resume continues the held task.
  const resume = popup().getByRole("button", { name: en["monitor.popup.resumeTask"], exact: true });
  await resume.waitFor();
  await resume.click();
  report.stateAfterResume = await waitFor(
    page,
    "the resumed task",
    () => taskState(channel.id, busy.task.id),
    (state) => state !== "paused",
  );

  const out = resolve(import.meta.dirname, "../.openbot-build");
  mkdirSync(out, { recursive: true });
  report.screenshot = resolve(out, "monitor-popup.png");
  await page.screenshot({ path: report.screenshot });

  // Open thread, then Back to monitor.
  await popup().getByRole("button", { name: en["monitor.popup.openThread"], exact: true }).click();
  const back = page.getByRole("button", { name: en["monitor.return.back"], exact: true });
  await back.waitFor();
  await back.click();
  await page.locator(".monitor-page").waitFor();
  report.backToMonitor = (await back.count()) === 0;
  assert.ok(report.backToMonitor, "Back to monitor did not show the Monitor.");

  report.passed = true;
  process.stdout.write(`Wrote ${report.screenshot}\n`);
} finally {
  await client.cleanup();
  process.stdout.write(`Wrote ${writeReport("monitor-popup-e2e", report)}\n`);
  await session.close();
}
