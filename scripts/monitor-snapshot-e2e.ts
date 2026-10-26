// Checks the Monitor snapshot of a channel in this worktree's running dev app, with real provider
// turns. Start the app with `bun run dev` (never `--shared`), then run
// `bun run test:monitor-snapshot -- --allow-mutations`. It needs two visible agents whose provider
// is signed in.
//
// It makes a channel with two agents, asks each one for a short answer that runs one harmless shell
// command with a fake secret in it, reads `window.openbot.monitor.getSnapshot` while the turns run
// and after they end, and checks that both agents, their tool calls and the event feed are there,
// that the snapshot passes the contract guard, that the fake secret never reaches the window, and
// that a change event arrives. It deletes its channel at the end.
// Writes .openbot-build/monitor-snapshot.json (the newest snapshot) and
// .openbot-build/monitor-snapshot-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMonitorSnapshot, type MonitorChange, type MonitorSnapshot } from "@openbot/contracts/ipc";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

declare global {
  interface Window {
    monitorSnapshotE2e?: { changes: MonitorChange[]; stop: () => void };
  }
}

/** Looks like a key to the log redaction, and is no real credential. */
const FAKE_SECRET = `sk-monitor-e2e-${crypto.randomUUID().replaceAll("-", "")}`;
const prompt = (name: string) =>
  `Run this shell command once: echo "API_KEY=${FAKE_SECRET}" > /dev/null. Then reply with the single word ${name}.`;

interface Report {
  channelId?: string;
  agents?: Array<{ id: string; status: string }>;
  runningSeen?: boolean;
  toolCalls?: number;
  events?: number;
  changes?: number;
  secretReachedWindow?: boolean;
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("monitor-snapshot-e2e");
const { page } = session;
const client = new ChannelClient(page);

const readSnapshot = (channelId: string): Promise<MonitorSnapshot> =>
  page.evaluate((id) => window.openbot.monitor.getSnapshot({ channelId: id }), channelId);

function writeSnapshot(snapshot: MonitorSnapshot): string {
  const out = resolve(import.meta.dirname, "../.openbot-build");
  mkdirSync(out, { recursive: true });
  const path = resolve(out, "monitor-snapshot.json");
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return path;
}

try {
  const agents = (await client.agents()).slice(0, 2);
  assert.equal(agents.length, 2, "The monitor E2E needs two visible agents on a signed-in provider.");
  const [lead, member] = agents;
  assert.ok(lead && member);
  const channel = await client.create(`monitor-e2e-${Date.now()}`, [lead.id, member.id], lead.id);
  report.channelId = channel.id;

  // The first read starts the change events of the channel.
  const first = await readSnapshot(channel.id);
  assert.ok(isMonitorSnapshot(first), "The first snapshot does not pass the contract guard.");
  assert.deepEqual(new Set(first.agents.map((agent) => agent.id)), new Set([lead.id, member.id]));

  await page.evaluate(() => {
    const changes: MonitorChange[] = [];
    const stop = window.openbot.monitor.onChanged((change) => changes.push(change));
    window.monitorSnapshotE2e = { changes, stop };
  });

  await client.send(channel.id, prompt("first"), lead.id);
  await client.send(channel.id, prompt("second"), member.id);

  // While a turn runs, its agent is `working` and the snapshot shows it.
  const running = await waitFor(
    page,
    "an agent working in the monitor snapshot",
    () => readSnapshot(channel.id),
    (snapshot) => snapshot.agents.some((agent) => agent.status === "working"),
  ).catch(() => null);
  report.runningSeen = running !== null;

  // Both agents answered in the channel and no turn runs any more.
  const done = await waitFor(
    page,
    "both agents answered and stopped working",
    () => readSnapshot(channel.id),
    (snapshot) =>
      snapshot.agents.every((agent) => agent.status !== "working") &&
      [lead.id, member.id].every((agentId) =>
        snapshot.events.some((event) => event.kind === "message" && event.agentId === agentId),
      ),
  );
  assert.ok(isMonitorSnapshot(done), "The final snapshot does not pass the contract guard.");
  assert.ok(done.revision > first.revision, "The revision did not grow after the turns.");
  assert.ok(done.toolCalls.length > 0, "No tool call reached the snapshot.");
  const changes = await page.evaluate(() => window.monitorSnapshotE2e?.changes.length ?? 0);
  assert.ok(changes > 0, "No monitor change event reached the window.");

  const text = JSON.stringify([first, running, done]);
  report.secretReachedWindow = text.includes(FAKE_SECRET);
  assert.equal(report.secretReachedWindow, false, "The fake secret reached the window unredacted.");

  report.agents = done.agents.map((agent) => ({ id: agent.id, status: agent.status }));
  report.toolCalls = done.toolCalls.length;
  report.events = done.events.length;
  report.changes = changes;
  report.passed = true;
  process.stdout.write(`Wrote ${writeSnapshot(done)}\n`);
} finally {
  await page.evaluate(() => window.monitorSnapshotE2e?.stop()).catch(() => undefined);
  await client.cleanup();
  process.stdout.write(`Wrote ${writeReport("monitor-snapshot-e2e", report)}\n`);
  await session.close();
}
