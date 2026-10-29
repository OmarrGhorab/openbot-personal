// Checks that Arrow Up and Down recall sent messages in a running Storybook, which renders the real
// shared composer. Pass the URL that `bun run storybook` reports:
// `bun scripts/composer-message-history-e2e.ts --storybook=http://localhost:6006`.
// Writes .openbot-build/composer-message-history-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/composer-message-history-e2e");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
const browserExecutable = process.argv
  .find((arg) => arg.startsWith("--browser-executable="))
  ?.slice("--browser-executable=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

interface Report {
  steps: { action: string; text: string; caret?: number }[];
  passed: boolean;
}

const report: Report = { steps: [], passed: false };

async function editorText(editor: Locator): Promise<string> {
  return (await editor.innerText()).replace(/\n$/u, "");
}

async function caretOffset(editor: Locator): Promise<number> {
  return editor.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();
    if (!selection?.focusNode) return -1;
    const prefix = element.ownerDocument.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(selection.focusNode, selection.focusOffset);
    return prefix.toString().length;
  });
}

async function placeCaretAtEnd(editor: Locator): Promise<void> {
  await editor.evaluate((element) => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = element.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

async function press(page: Page, editor: Locator, key: string, expected: string): Promise<void> {
  await page.keyboard.press(key);
  const text = await editorText(editor);
  report.steps.push({ action: key, text, caret: await caretOffset(editor) });
  assert.equal(text, expected, `After ${key} the composer must show ${JSON.stringify(expected)}.`);
}

async function clear(page: Page, editor: Locator): Promise<void> {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  assert.equal(await editorText(editor), "");
}

async function send(page: Page, editor: Locator, text: string): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  report.steps.push({ action: `send ${text}`, text: await editorText(editor) });
  assert.equal(await editorText(editor), "", "Sending must clear the composer.");
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: resolve(browserExecutable), args: ["--no-sandbox"] } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${storybook}/iframe.html?id=conversation-composereditor--sent-message-history&viewMode=story`);
  const editor = page.getByRole("textbox", { name: "Message Chief" });
  await editor.waitFor({ timeout: 60_000 });
  await editor.click();

  await send(page, editor, "First message");
  await send(page, editor, "Second message");

  // Up keeps the draft, walks to the oldest and stays there; Down walks back and restores the draft.
  await page.keyboard.type("my draft");
  await press(page, editor, "ArrowUp", "Second message");
  assert.equal(await caretOffset(editor), "Second message".length, "A recalled message puts the caret at its end.");
  await press(page, editor, "ArrowUp", "First message");
  await press(page, editor, "ArrowUp", "First message");
  await press(page, editor, "ArrowDown", "Second message");
  await press(page, editor, "ArrowDown", "my draft");
  await press(page, editor, "ArrowDown", "my draft");

  // Editing a recalled message makes it the draft again, so Down is a plain caret move.
  await clear(page, editor);
  await press(page, editor, "ArrowUp", "Second message");
  await page.keyboard.type(" edited");
  await press(page, editor, "ArrowDown", "Second message edited");
  await press(page, editor, "ArrowUp", "Second message");
  await press(page, editor, "ArrowDown", "Second message edited");

  // A three-line draft moves the caret between its lines first; only Up on the first line recalls.
  const threeLines = "line one\nline two\nline three";
  await editor.fill(threeLines);
  await placeCaretAtEnd(editor);
  await press(page, editor, "ArrowUp", threeLines);
  const afterFirstUp = await caretOffset(editor);
  assert.ok(
    afterFirstUp > "line one".length && afterFirstUp <= "line one\nline two".length,
    `The first Up must move the caret to the second line, not to ${afterFirstUp}.`,
  );
  await press(page, editor, "ArrowUp", threeLines);
  assert.ok((await caretOffset(editor)) <= "line one".length, "The second Up must reach the first line.");
  await press(page, editor, "ArrowUp", "Second message edited");
  await press(page, editor, "ArrowDown", threeLines);

  // An open @ picker keeps Arrow Up and Down for its options.
  await clear(page, editor);
  await page.keyboard.type("@");
  await page.getByRole("listbox").waitFor({ timeout: 10_000 });
  await press(page, editor, "ArrowUp", "@");
  await press(page, editor, "ArrowDown", "@");
  assert.ok(await page.getByRole("listbox").isVisible(), "The picker must stay open.");

  report.passed = true;
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
