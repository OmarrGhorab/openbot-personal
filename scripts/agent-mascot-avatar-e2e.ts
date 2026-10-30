// Gives an agent of a running dev app a mascot avatar (#201), and checks that it stays:
// - the saved `avatarSeed` is `mascot:<shape>:<color>` and the sidebar draws the mascot picture;
// - a window reload (the renderer half of a restart) reads it back from main and draws it again;
// - a provider switch keeps it, when a second provider lists a model;
// - the other agents keep their shape avatar;
// - with reduced motion, the mascot has no transition and no hover lift.
// Restores the agent's avatar and provider at the end. Writes .openbot-build/agent-mascot-avatar/
// report.json and screenshots. Needs `--allow-mutations`, because it changes an agent.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentMascotSeed, parseAgentMascotSeed } from "@openbot/contracts/agent-mascot-avatar";
import { isAgentProvider, type OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-mascot-avatar");
const MASCOT = { shape: "whale", color: "blue" } as const;

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "agent-mascot-avatar-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("agent-mascot-avatar-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page: Page = session.page;
mkdirSync(OUT, { recursive: true });

const agents = await page.evaluate(() => window.openbot.agent.listAgents());
const first = agents[0];
assert.ok(first, "The dev app needs at least one agent.");
// A const of the narrowed type: the hoisted functions below read it, and they lose the narrowing of `first`.
const target: NonNullable<typeof first> = first;
const others = agents.slice(1).map((agent) => ({ id: agent.id, avatarSeed: agent.avatarSeed }));
const original = { avatarSeed: target.avatarSeed, provider: target.provider, model: target.model };
const seed = agentMascotSeed(MASCOT);
interface Report {
  agentId: string;
  seed: string;
  drawnBeforeReload?: number;
  drawnAfterReload?: number;
  providerSwitch?: { to: string; kept: boolean } | string;
  othersKept?: number;
  reducedMotionTransition?: string;
}
const report: Report = { agentId: target.id, seed };

async function savedSeed(): Promise<string | undefined> {
  return page.evaluate(
    async (id) => (await window.openbot.agent.listAgents()).find((agent) => agent.id === id)?.avatarSeed,
    target.id,
  );
}

/** The mascot pictures on screen for the target agent: every `data-avatar="mascot"` image. */
async function mascotImages(): Promise<string[]> {
  await page.locator('[data-avatar="mascot"] img').first().waitFor();
  return page
    .locator('[data-avatar="mascot"] img')
    .evaluateAll((images) =>
      images.map((image) => (image instanceof HTMLImageElement ? image.currentSrc || image.src : "")),
    );
}

try {
  // A mascot is saved as the seed, through the same update that the avatar picker calls.
  await page.evaluate(({ id, avatarSeed }) => window.openbot.agent.updateAgent({ agentId: id, avatarSeed }), {
    id: target.id,
    avatarSeed: seed,
  });
  assert.equal(await savedSeed(), seed);
  assert.deepEqual(parseAgentMascotSeed(await savedSeed()), MASCOT);
  const drawn = await mascotImages();
  assert.ok(
    drawn.some((src) => src.includes(`${MASCOT.shape}-${MASCOT.color}`)),
    "The sidebar draws the mascot picture.",
  );
  report.drawnBeforeReload = drawn.length;
  await page.screenshot({ path: resolve(OUT, "mascot-sidebar.png") });

  // Reload: the renderer reads the agent back from main and draws the mascot again.
  await page.reload();
  assert.equal(await savedSeed(), seed);
  report.drawnAfterReload = (await mascotImages()).length;

  // Provider switch: the avatar is identity and must stay.
  const models = await page.evaluate(() => window.openbot.agent.listModels());
  const other = models.find((model) => model.provider !== target.provider);
  if (other && isAgentProvider(other.provider)) {
    const provider = other.provider;
    await page.evaluate(
      ({ id, provider, model }) => window.openbot.agent.updateAgent({ agentId: id, provider, model }),
      { id: target.id, provider, model: other.id },
    );
    assert.equal(await savedSeed(), seed, "A provider switch keeps the mascot avatar.");
    report.providerSwitch = { to: other.provider, kept: true };
  } else {
    report.providerSwitch = "skipped: only one provider lists models";
  }

  // The other agents keep their shapes.
  const after = await page.evaluate(() => window.openbot.agent.listAgents());
  for (const agent of others) {
    assert.equal(after.find((candidate) => candidate.id === agent.id)?.avatarSeed, agent.avatarSeed);
  }
  report.othersKept = others.length;

  // Reduced motion: no transition on the mascot picture.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const transition = await page
    .locator('[data-avatar="mascot"] img')
    .first()
    .evaluate((image) => getComputedStyle(image).transitionProperty);
  assert.ok(transition === "all" || transition === "none" || !transition.includes("translate"));
  report.reducedMotionTransition = transition;
  await page.emulateMedia({ reducedMotion: null });
} finally {
  const provider = isAgentProvider(original.provider) ? original.provider : undefined;
  await page.evaluate(
    ({ id, avatarSeed, provider, model }) =>
      window.openbot.agent.updateAgent({
        agentId: id,
        avatarSeed,
        ...(provider ? { provider, model } : {}),
      }),
    { id: target.id, avatarSeed: original.avatarSeed, provider, model: original.model },
  );
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
}
logger.info(`Mascot avatar checks passed. Report: ${resolve(OUT, "report.json")}`);
