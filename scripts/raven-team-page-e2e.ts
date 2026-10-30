// Drives the Raven Stack team page and its Autopilot tab in this worktree's dev app (`bun run dev`).
//   1. Tabs: the page opens on Set up. The tab list holds Set up, Autopilot and Team jobs, and each tab
//      shows its own content. The Autopilot tab shows the On pill only while Autopilot is on.
//   2. Autopilot: the master switch, "Raven picks the stack", "Pause on a usage limit" and "Reviewer can
//      merge" each save through `window.openbot.ravenAutopilot` and come back from `get()` as shown.
//   3. Guardrails: the Tickets at once and Rounds steppers stay inside 1..8 and 1..10.
//   4. Restore: the settings the app had before the run are saved again, whatever failed.
// Start the dev app, then run the script with `--allow-mutations`:
//   bun run dev
//   bun scripts/raven-team-page-e2e.ts --allow-mutations
// Writes .openbot-build/raven-team-page/report.json and a screenshot of each tab.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OpenBotDesktopApi, RavenAutopilotSettings } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import type { Locator, Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/raven-team-page");
const TICKETS_AT_ONCE = { min: 1, max: 8 };
const ROUND_CAP = { min: 1, max: 10 };

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

const record = readDevInstanceRecords().find(
  (candidate) => candidate.service === "app" && resolve(candidate.projectRoot) === resolve(process.cwd()),
);
assert.ok(record, "Start `bun run dev` for this worktree first.");
assertMutationAllowed({
  command: "raven-team-page-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: record.instanceId,
});

const logger = createOpenBotLogger("raven-team-page-e2e");
const session = await connectToDevApp(record.remoteDebuggingPort, logger, {
  expectedRendererPort: record.rendererPort,
  ownerPid: record.pid,
});
const page = session.page;
page.setDefaultTimeout(20_000);

mkdirSync(OUT, { recursive: true });
const checks: Check[] = [];
const check = (name: string, passed: boolean, detail: unknown = null) => {
  checks.push({ name, passed, detail });
  logger.info(`${passed ? "Passed" : "Failed"}: ${name}.`);
};

const readSettings = (target: Page) => target.evaluate(() => window.openbot.ravenAutopilot.get());
const saveSettings = (target: Page, settings: RavenAutopilotSettings) =>
  target.evaluate((next) => window.openbot.ravenAutopilot.set(next), settings);

/** Waits until the saved settings pass `test`, so a switch is read after main has written it. */
async function settled(test: (settings: RavenAutopilotSettings) => boolean): Promise<RavenAutopilotSettings> {
  const deadline = Date.now() + 10_000;
  let settings = await readSettings(page);
  while (!test(settings) && Date.now() < deadline) {
    await page.waitForTimeout(100);
    settings = await readSettings(page);
  }
  return settings;
}

const isChecked = async (control: Locator) => (await control.getAttribute("aria-checked")) === "true";

/** Flips a switch and checks that the saved value and the switch agree afterwards. */
async function flip(
  name: string,
  control: Locator,
  read: (settings: RavenAutopilotSettings) => boolean,
): Promise<void> {
  const before = await isChecked(control);
  await control.click();
  const saved = await settled((settings) => read(settings) !== before);
  check(`${name} saves`, read(saved) !== before, { before, saved: read(saved) });
  check(`${name} shows the saved value`, (await isChecked(control)) === read(saved), null);
}

/** Presses a stepper button until it is disabled and returns the saved value. */
async function pressToEnd(button: Locator, read: (settings: RavenAutopilotSettings) => number): Promise<number> {
  for (let presses = 0; presses < 12 && (await button.isEnabled()); presses += 1) {
    const before = read(await readSettings(page));
    await button.click();
    await settled((settings) => read(settings) !== before);
  }
  return read(await readSettings(page));
}

const original = await readSettings(page);
try {
  // 1. Tabs ------------------------------------------------------------------------
  await saveSettings(page, { ...original, enabled: false });
  const opener = page
    .getByRole("button", { name: "Raven Stack team" })
    .or(page.getByRole("link", { name: "Raven Stack team" }))
    .first();
  await opener.click();
  await page.getByRole("heading", { name: "Raven Stack team" }).waitFor();
  const tabs = page.getByRole("tablist", { name: "Raven team views" });
  await tabs.waitFor();
  const tabNames = (await tabs.getByRole("tab").allTextContents()).map((name) => name.trim());
  check(
    "the tab list holds Set up, Autopilot and Team jobs",
    tabNames.length === 3 &&
      tabNames[0] === "Set up" &&
      tabNames[1]?.startsWith("Autopilot") === true &&
      tabNames[2]?.startsWith("Team jobs") === true,
    tabNames,
  );
  const setupTab = tabs.getByRole("tab", { name: "Set up" });
  const autopilotTab = tabs.getByRole("tab", { name: /^Autopilot/u });
  const jobsTab = tabs.getByRole("tab", { name: /^Team jobs/u });
  check("the page opens on Set up", (await setupTab.getAttribute("aria-selected")) === "true", null);
  await page.screenshot({ path: resolve(OUT, "setup.png") });

  await jobsTab.click();
  check("Team jobs is selected", (await jobsTab.getAttribute("aria-selected")) === "true", null);
  await page.screenshot({ path: resolve(OUT, "jobs.png") });

  await autopilotTab.click();
  check("Autopilot is selected", (await autopilotTab.getAttribute("aria-selected")) === "true", null);
  const master = page.getByRole("switch", { name: "Autopilot", exact: true });
  await master.waitFor();
  check("the Autopilot tab has no On pill while Autopilot is off", !(await autopilotTab.textContent())?.includes("On"));

  // 2. Autopilot switches ------------------------------------------------------------
  await flip("the master switch", master, (settings) => settings.enabled);
  const enabled = (await readSettings(page)).enabled;
  check(
    "the On pill follows the master switch",
    ((await autopilotTab.textContent()) ?? "").includes("On") === enabled,
    { enabled, tab: await autopilotTab.textContent() },
  );
  await page.screenshot({ path: resolve(OUT, "autopilot.png"), fullPage: true });

  await flip(
    "Raven picks the stack",
    page.getByRole("switch", { name: "Raven picks the stack for every ticket" }),
    (settings) => settings.autoStack,
  );
  await flip(
    "Pause on a usage limit",
    page.getByRole("switch", { name: "Pause on a usage limit" }),
    (settings) => settings.pauseOnUsageLimit,
  );
  await flip(
    "Reviewer can merge",
    page.getByRole("switch", { name: "Reviewer can merge" }),
    (settings) => settings.reviewerMerge.enabled,
  );

  // 3. Guardrail steppers ------------------------------------------------------------
  const ticketsMax = await pressToEnd(
    page.getByRole("button", { name: "Increase Tickets at once" }),
    (settings) => settings.ticketsAtOnce,
  );
  const ticketsMin = await pressToEnd(
    page.getByRole("button", { name: "Decrease Tickets at once" }),
    (settings) => settings.ticketsAtOnce,
  );
  check("Tickets at once stays inside 1..8", ticketsMax === TICKETS_AT_ONCE.max && ticketsMin === TICKETS_AT_ONCE.min, {
    ticketsMax,
    ticketsMin,
  });
  const roundsMax = await pressToEnd(
    page.getByRole("button", { name: "Increase Rounds before it stops" }),
    (settings) => settings.roundCap,
  );
  const roundsMin = await pressToEnd(
    page.getByRole("button", { name: "Decrease Rounds before it stops" }),
    (settings) => settings.roundCap,
  );
  check("Rounds stays inside 1..10", roundsMax === ROUND_CAP.max && roundsMin === ROUND_CAP.min, {
    roundsMax,
    roundsMin,
  });

  await setupTab.click();
  check("Set up is selected again", (await setupTab.getAttribute("aria-selected")) === "true", null);
} catch (failure) {
  check("the run finished", false, failure instanceof Error ? failure.message : String(failure));
} finally {
  // 4. Restore -----------------------------------------------------------------------
  await saveSettings(page, original);
  const restored = await readSettings(page);
  check("the settings from before the run are back", JSON.stringify(restored) === JSON.stringify(original), null);
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ checks }, null, 2)}\n`);
  await session.close();
}

const failed = checks.filter((entry) => !entry.passed);
if (failed.length > 0) {
  logger.error(`${failed.length} of ${checks.length} checks failed. See ${resolve(OUT, "report.json")}.`);
  process.exitCode = 1;
} else {
  logger.info(`All ${checks.length} checks passed.`);
}
