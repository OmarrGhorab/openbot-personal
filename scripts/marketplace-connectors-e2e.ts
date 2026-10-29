// Exercises an existing local dev app. Opens Server settings and the Marketplace page; changes nothing.
// Connectors live in Marketplace › Apps: Server settings has no Connectors section, and the re-sign-in
// after a copy opens the Marketplace instead of Server settings.
// Run: bun scripts/marketplace-connectors-e2e.ts
// Writes .openbot-build/marketplace-connectors-e2e/report.json and server-settings.png.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { copySetupReauthDestination } from "../src/renderer/src/features/servers/copy-setup-reauth";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const OUT = resolve(import.meta.dirname, "../.openbot-build/marketplace-connectors-e2e");
const steps: string[] = [];

// A connector that needs its sign-in again after a copy opens Marketplace › Apps. Providers and MCP
// keep their Server settings sections.
assert.deepEqual(copySetupReauthDestination("connectors"), { kind: "marketplace-apps" });
assert.deepEqual(copySetupReauthDestination("providers"), { kind: "server-settings", section: "providers" });
assert.deepEqual(copySetupReauthDestination("mcp"), { kind: "server-settings", section: "mcp" });
steps.push("re-sign-in of a connector opens the Marketplace");

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "marketplace-connectors-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("marketplace-connectors-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
try {
  const page = session.page;
  const rail = page.getByRole("navigation", { name: "Pages", exact: true });
  const railButton = (name: string) => rail.getByRole("button", { name, exact: true });
  const marketplace = page.getByRole("region", { name: "Marketplace", exact: true });
  const waitForPage = (name: string) =>
    page.waitForFunction(
      (expected) => document.querySelector("[data-window-page]")?.getAttribute("data-window-page") === expected,
      name,
    );

  await railButton("Agents").click();
  await waitForPage("agents");

  // Server settings lists its sections, and Connectors is not one of them.
  await page
    .getByRole("button", { name: /^Open settings for / })
    .first()
    .click();
  const sections = page.getByRole("tablist", { name: "Server settings sections", exact: true });
  await sections.waitFor();
  assert.ok((await sections.getByRole("tab").count()) > 0, "Server settings shows no sections.");
  const connectorsTab = sections.getByRole("tab", { name: "Connectors", exact: true });
  assert.equal(await connectorsTab.count(), 0, "Server settings still shows a Connectors section.");
  assert.equal(await page.locator('[data-tab="connectors"]').count(), 0, "A Connectors panel is still mounted.");
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, "server-settings.png") });
  steps.push("server settings shows no Connectors section");

  await railButton("Agents").click();
  await waitForPage("agents");
  await sections.waitFor({ state: "detached" });

  // The re-sign-in opens the Marketplace, which starts on Apps, where the connectors are.
  await railButton("Marketplace").click();
  await marketplace.waitFor();
  await waitForPage("marketplace");
  const kinds = marketplace.getByRole("navigation", { name: "Marketplace content types" }).getByRole("button");
  assert.equal((await kinds.first().innerText()).trim(), "Apps");
  assert.equal(await kinds.first().getAttribute("aria-current"), "page");
  steps.push("the Marketplace opens on Apps");

  await railButton("Agents").click();
  await waitForPage("agents");
  await marketplace.waitFor({ state: "detached" });

  const report = { passed: true, steps };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await session.close();
}
