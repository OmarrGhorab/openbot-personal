// drive.mjs <cdp-port> <command> [arg]: drives one OpenBot dev instance over CDP. See SKILL.md.
import { join } from "node:path";

const [port, command = "doctor", arg = ""] = process.argv.slice(2);
const { chromium } = await import(join(process.cwd(), "node_modules/playwright-core/index.mjs"));
const out = (value) => process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 1)}\n`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => /^http:\/\/(localhost|127\.0\.0\.1):\d+\/(?:#.*)?$/u.test(candidate.url()));
  if (!page) throw new Error("No renderer page on this CDP port.");
  const visible = (text) => page.getByText(text, { exact: true }).locator("visible=true").first();
  switch (command) {
    case "doctor": {
      const state = await page.evaluate(() => ({
        bridge: typeof window.openbot === "object",
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        size: [window.innerWidth, window.innerHeight],
      }));
      if (!state.bridge) throw new Error("The preload bridge (window.openbot) is missing.");
      out({ url: page.url(), ...state });
      break;
    }
    case "tickets":
      await page.getByRole("button", { name: /^(Tickets|التذاكر)$/u }).first().click();
      break;
    case "ticket":
      await page.getByRole("button", { name: /^(Tickets|التذاكر)$/u }).first().click();
      await visible(arg).click();
      break;
    case "chat":
      await page.getByRole("button", { name: /^(Agents|الإيجنتس|Chats)$/u }).first().click().catch(() => undefined);
      await visible(arg).click();
      break;
    case "send": {
      const box = page.locator("[contenteditable=true], textarea").last();
      await box.click();
      await page.keyboard.type(arg);
      await page.keyboard.press("Enter");
      break;
    }
    case "settings":
      await page.getByRole("button", { name: /^(Settings|الإعدادات)$/u }).first().click();
      break;
    case "lang":
      await page.evaluate((language) => window.openbot.setAppLanguagePreference({ language }), arg);
      await page.waitForTimeout(1500);
      out(await page.evaluate(() => document.documentElement.dir || "ltr"));
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
  await page.waitForTimeout(800);
} finally {
  await browser.close().catch(() => undefined);
}
