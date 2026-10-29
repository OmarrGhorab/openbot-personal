// Checks that installing Apple apps from the Marketplace asks macOS for access to the Apple apps, in a
// running Storybook. The App stories render the real window and Marketplace controller on the preview
// mock, whose macOS Automation call answers from the story's fixtures: every app allowed (Playground),
// Mail and Messages refused, or Safari failed. Nothing reaches macOS.
// Pass the URL that `bun run storybook` reports:
// `bun scripts/marketplace-mac-access-e2e.ts --storybook=http://localhost:6006 [--browser-executable=<path>]`.
// Writes .openbot-build/marketplace-mac-access-e2e/report.json and a screenshot of each case.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/marketplace-mac-access-e2e");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const storybook = option("storybook");
const browserExecutable = option("browser-executable");
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

const SETTINGS_PATH = "System Settings › Privacy & Security › Automation";

interface Said {
  notice: string;
  error: string;
}

interface Case {
  /** The App story, whose mock answers for each Apple app. */
  story: string;
  name: "allowed" | "refused" | "failed";
  /** What the window says after macOS answered. Throws while it does not say it. */
  check: (said: Said) => void;
}

const CASES: Case[] = [
  {
    story: "app--playground",
    name: "allowed",
    check: ({ notice, error }) => {
      assert.equal(notice, "OpenBot can now control all of the Apple apps.");
      assert.equal(error, "");
    },
  },
  {
    story: "app--mac-automation-refused",
    name: "refused",
    check: ({ error }) => {
      // The refusal names the apps that macOS refused, and only those, and where to change it.
      assert.match(error, /^macOS did not give access to /);
      assert.ok(error.includes("Mail") && error.includes("Messages"), `The refusal does not name the apps: ${error}`);
      assert.ok(!error.includes("Calendar"), `The refusal names an app that macOS allowed: ${error}`);
      assert.ok(error.includes(SETTINGS_PATH), `The refusal does not say where to allow OpenBot: ${error}`);
    },
  },
  {
    story: "app--mac-automation-failed",
    name: "failed",
    check: ({ error }) => {
      assert.equal(error, "OpenBot could not ask macOS about Safari. Try again.");
    },
  },
];

const steps: string[] = [];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** Runs `check` until it passes, and throws its last failure after `timeoutMs`. */
async function eventually(check: () => Promise<void>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (failure) {
      if (Date.now() > deadline) throw failure;
      await new Promise((done) => setTimeout(done, 100));
    }
  }
}

async function openAppleApps(page: Page, story: string): Promise<Locator> {
  const url = new URL("iframe.html", storybook);
  url.searchParams.set("id", story);
  url.searchParams.set("viewMode", "story");
  await page.goto(url.toString());
  const rail = page.getByRole("navigation", { name: "Pages", exact: true });
  await rail.getByRole("button", { name: "Marketplace", exact: true }).click();
  const marketplace = page.getByRole("region", { name: "Marketplace", exact: true });
  await marketplace.waitFor();
  await marketplace.getByRole("searchbox").fill("Apple apps");
  await marketplace.getByRole("button", { name: "Open Apple apps", exact: true }).click();
  return marketplace;
}

const browser = await chromium.launch({
  headless: true,
  ...(browserExecutable ? { executablePath: browserExecutable } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  for (const testCase of CASES) {
    const marketplace = await openAppleApps(page, testCase.story);
    const said = async (): Promise<Said> => ({
      notice: (await marketplace.locator('[role="status"][data-live-announcer]').textContent())?.trim() ?? "",
      error: (await marketplace.locator('[role="alert"][data-live-announcer]').textContent())?.trim() ?? "",
    });

    // Before the install, the switch says whether the install asks macOS, and it starts on.
    const ask = marketplace.getByRole("switch", { name: "Ask macOS for access at install" });
    await ask.waitFor();
    assert.equal(await ask.isChecked(), true, "The install does not ask macOS by default.");
    if (testCase.name === "allowed") {
      // The input of the switch is hidden under its track, so the label turns it.
      const label = marketplace.getByText("Ask macOS for access at install", { exact: true });
      await label.click();
      assert.equal(await ask.isChecked(), false, "The switch did not turn off.");
      await label.click();
      assert.equal(await ask.isChecked(), true, "The switch did not turn back on.");
      steps.push("the switch asks macOS by default and turns off and on");
    }

    // The install saves the app, then asks macOS for each Apple app it drives. The switch gives way to
    // the button that asks again.
    await marketplace.getByRole("button", { name: "Connect Apple apps", exact: true }).click();
    const request = marketplace.getByRole("button", { name: "Ask for access", exact: true });
    await request.waitFor();
    await ask.waitFor({ state: "detached" });
    await eventually(async () => testCase.check(await said()));
    await page.screenshot({ path: resolve(OUT, `${testCase.name}.png`) });
    steps.push(`the install says macOS ${testCase.name}`);

    // After the install, the button asks again and says the same.
    await eventually(async () => assert.equal(await request.isEnabled(), true));
    await request.click();
    await eventually(async () => assert.equal(await request.isEnabled(), true));
    await eventually(async () => testCase.check(await said()));
    steps.push(`"Ask for access" says macOS ${testCase.name}`);
  }

  const report = { passed: true, steps };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await browser.close();
}
