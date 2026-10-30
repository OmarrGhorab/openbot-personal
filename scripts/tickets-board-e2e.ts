// Checks the Tickets page (#155). It drives the real app against the preview mock in a running
// Storybook, on the `App/Tickets Board` story, and clicks every button that the page shows: the Board
// and By agent switch, a lane, the agent strip, Pause, Resume and Stop of a work thread, Open ticket,
// the drawer stepper, the agent picker, Start now, Open issue, the steer box, Delete and its
// confirmation, New ticket with Cancel, Add to backlog and Start now, and Open thread. It also checks
// that agents move their own tickets (#156): Stop puts a ticket back in Backlog with the failure line,
// and a started ticket moves from Running to Needs review when its turn ends, with no click. With GitHub
// connected, Sync imports the open issues of a repository into Backlog with their issue link (#158).
// Each Raven team job has its own ticket and one ticket per role, assigned to the role's agent; the job's
// drawer lists its role tickets, and the tickets move when the job stops and the queued job starts (#157).
//
// Pass the Storybook URL that `bun run storybook` reports:
//   bun scripts/tickets-board-e2e.ts --storybook=http://localhost:6006
// Writes .openbot-build/tickets-board-e2e/report.json and screenshots beside it.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { chromium, type Locator, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/tickets-board-e2e");
const t = translateFor("en");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

/** The seeded tickets and agents of the story. */
const RUNNING = "Fix the login timeout";
const BACKLOG = "Write the release notes";
const UNASSIGNED = "Clean up old logs";
const CHIEF = "Chief";
const SALES = "Sales Outbound";
const ADDED = "Add a dark mode switch";
const STARTED = "Ship the changelog";
const STEER = "Keep the old session API for one release.";
const SYNC_REPOSITORY = "OmarrGhorab/openbot-personal";
const IMPORTED = "Show the issue link on each card";
const IMPORTED_KEY = "omarrghorab/openbot-personal#158";
/** The card shows the short key of a GitHub issue (#188); the full key is its tooltip. */
const IMPORTED_SHORT_KEY = "#158";
/** The seeded Autopilot lite team jobs: one runs, one waits in Queued. */
const TEAM_JOB = "Add a retry to the upload";
const TEAM_JOB_ID = "story-team-job-1";
const QUEUED_JOB = "Show the sync time on the board";

interface Report {
  steps: string[];
  errors: string[];
  /** Error toasts the app showed after an action that worked. Each one fails the run. */
  appErrors: string[];
  passed: boolean;
  failure?: string;
}

const report: Report = { steps: [], errors: [], appErrors: [], passed: false };

function column(
  page: Page,
  status:
    | "tickets.status.backlog"
    | "tickets.status.queued"
    | "tickets.status.running"
    | "tickets.status.needsReview"
    | "tickets.status.done",
): Locator {
  return page.getByRole("region", { name: t(status), exact: true });
}

function card(scope: Locator | Page, title: string): Locator {
  return scope.getByRole("button").filter({ hasText: title });
}

/** The card of a team job's own ticket, not the cards of its role tickets. */
function jobCard(scope: Locator | Page, title: string): Locator {
  return card(scope, title).filter({ hasNotText: "Builder: " }).filter({ hasNotText: "Reviewer: " });
}

/**
 * Fails when another element is on top of the centre of `target` (#176). Playwright waits and retries a
 * click on such an element; this check fails at once and names the element that took the click.
 */
async function assertTakesClicks(target: Locator, name: string): Promise<void> {
  const hit = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      takesClicks: top !== null && element.contains(top),
      pointerEvents: getComputedStyle(element).pointerEvents,
      top: top ? `${top.tagName.toLowerCase()}.${[...top.classList].join(".")}` : "nothing",
    };
  });
  assert.ok(
    hit.takesClicks && hit.pointerEvents !== "none",
    `${name} takes no clicks: pointer-events is ${hit.pointerEvents}, and ${hit.top} is on top of it.`,
  );
}

/**
 * The status line of the Sync dialog: "Not synced yet." for a board that never synced, or the time of
 * the last sync when the story opens the dialog with a target that synced before.
 */
function syncStatus(dialog: Locator): Locator {
  const [before = "", after = ""] = t("tickets.sync.lastSynced", { time: "\u0000" }).split("\u0000");
  const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return dialog
    .getByText(t("tickets.sync.never"), { exact: true })
    .or(dialog.getByText(new RegExp(`^${literal(before)}.+${literal(after)}$`, "u")));
}

/**
 * Chooses a repository in the Sync dialog. The repositories are toggle buttons in the "Repository or
 * project" group, and each button's name also holds its provider mark, so the button is found by its
 * text inside that group. The dialog may open with the repository already chosen (a saved target);
 * then it is pressed already and is not clicked again.
 */
async function chooseSyncProject(dialog: Locator, project: string): Promise<void> {
  const group = dialog.getByRole("region", { name: t("tickets.sync.project"), exact: true });
  const option = group.getByRole("button").filter({ hasText: project });
  await option.waitFor();
  if ((await option.getAttribute("aria-pressed")) !== "true") await option.click();
  assert.equal(await option.getAttribute("aria-pressed"), "true", `${project} is chosen in the Sync dialog.`);
}

/**
 * Saves the target and imports its issues. With a new or changed target the dialog offers Save and sync,
 * which closes it. With the saved target unchanged it offers Sync now instead, which keeps it open.
 */
async function saveAndSync(dialog: Locator): Promise<void> {
  const save = dialog.getByRole("button", { name: t("tickets.sync.save"), exact: true });
  const syncNow = dialog.getByRole("button", { name: t("tickets.sync.now"), exact: true });
  await save.or(syncNow).first().waitFor();
  if (await save.isVisible()) {
    await save.click();
  } else {
    await syncNow.click();
    await dialog.getByRole("button", { name: t("common.close"), exact: true }).click();
  }
  await dialog.waitFor({ state: "detached" });
}

/**
 * Records each error toast on the page as a failure of `action`, then closes it. The toast sits on top
 * of the page header and would take the next click, so closing it lets the later steps still run; the
 * run still fails at the end with the toast's text.
 */
async function recordErrorToasts(page: Page, action: string): Promise<void> {
  await page.waitForTimeout(500);
  const toasts = page.locator('[data-sonner-toast][data-type="error"]');
  for (const text of await toasts.allTextContents()) report.appErrors.push(`${action}: ${text.trim()}`);
  // The close button sits under the toast's own content in its corner, so it is pressed directly.
  for (const close of await toasts.getByRole("button", { name: t("notification.toast.close"), exact: true }).all()) {
    await close.dispatchEvent("click").catch(() => undefined);
  }
  await toasts.first().waitFor({ state: "detached" });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(`${storybook}/iframe.html?id=app--tickets-board&viewMode=story`);
  await page.getByRole("button", { name: t("app.rail.tickets"), exact: true }).click();
  await page.getByRole("heading", { level: 2, name: new RegExp(`^${t("tickets.title")}`, "u") }).waitFor();

  // The board: five columns, the seeded tickets in their columns.
  for (const status of [
    "tickets.status.backlog",
    "tickets.status.queued",
    "tickets.status.running",
    "tickets.status.needsReview",
    "tickets.status.done",
  ] as const) {
    await page.getByRole("region", { name: t(status), exact: true }).waitFor();
  }
  await card(column(page, "tickets.status.running"), RUNNING).waitFor();
  await card(column(page, "tickets.status.backlog"), BACKLOG).waitFor();
  await screenshot(page, "board");
  report.steps.push("The board shows five columns with the seeded tickets.");

  // The page opens with the agent list hidden. Each part of it takes clicks (#176).
  await assertTakesClicks(page.getByRole("button", { name: t("tickets.new"), exact: true }), "New ticket");
  await assertTakesClicks(page.getByRole("tab", { name: t("tickets.view.agents"), exact: true }), "By agent");
  await assertTakesClicks(page.getByRole("button", { name: t("tickets.sync.open"), exact: true }), "Sync");
  await assertTakesClicks(card(column(page, "tickets.status.backlog"), BACKLOG), "A ticket card");
  report.steps.push("With the agent list hidden, New ticket, the view switch, Sync and a card take clicks.");

  // Sync: GitHub is connected in this story. Save and sync imports the open issues of the repository into
  // Backlog, linked to their issues; Sync now imports them again and adds no copy.
  const syncButton = page.getByRole("button", { name: t("tickets.sync.open"), exact: true });
  const syncDialog = page.getByRole("dialog", { name: t("tickets.sync.title"), exact: true });
  await syncButton.click();
  await syncDialog.waitFor();
  await syncStatus(syncDialog).waitFor();
  await chooseSyncProject(syncDialog, SYNC_REPOSITORY);
  await screenshot(page, "sync");
  await saveAndSync(syncDialog);
  const imported = card(column(page, "tickets.status.backlog"), IMPORTED);
  const importedKey = imported.getByText(IMPORTED_SHORT_KEY, { exact: true });
  await importedKey.waitFor();
  assert.equal(await importedKey.getAttribute("title"), IMPORTED_KEY);
  await imported.click();
  const importedDrawer = page.getByRole("complementary", { name: IMPORTED, exact: true });
  await importedDrawer.getByRole("button", { name: t("tickets.drawer.openIssue"), exact: true }).waitFor();
  await importedDrawer.getByRole("button", { name: t("common.close"), exact: true }).click();
  await importedDrawer.waitFor({ state: "detached" });
  await syncButton.click();
  await syncDialog.getByRole("button", { name: t("tickets.sync.now"), exact: true }).click();
  await syncDialog.getByRole("button", { name: t("common.close"), exact: true }).click();
  await syncDialog.waitFor({ state: "detached" });
  assert.equal(await card(page, IMPORTED).count(), 1);
  report.steps.push(
    "Sync imports the open issues of the chosen repository into Backlog with their issue link, and Sync now adds no copy.",
  );

  // By agent: one lane for each agent. A lane header opens the agent panel.
  await page.getByRole("tab", { name: t("tickets.view.agents"), exact: true }).click();
  const chiefLane = page.getByRole("region", { name: CHIEF, exact: true });
  await card(chiefLane, RUNNING).waitFor();
  await page.getByRole("region", { name: t("tickets.card.unassigned"), exact: true }).waitFor();
  // The lane header is the first button of the lane; the cards follow it.
  await chiefLane.getByRole("button").first().click();
  const panel = page.getByRole("complementary", { name: CHIEF, exact: true });
  await panel.waitFor();
  await screenshot(page, "lanes");
  await panel.getByRole("button", { name: t("common.close"), exact: true }).click();
  await panel.waitFor({ state: "detached" });
  await page.getByRole("tab", { name: t("tickets.view.board"), exact: true }).click();
  await column(page, "tickets.status.backlog").waitFor();
  report.steps.push("By agent shows a lane for each agent and the unassigned lane; a lane header opens the panel.");

  // The agent strip opens the panel of the agent: its running thread with Pause, Resume and Stop.
  const strip = page.getByRole("region", { name: t("tickets.strip.label"), exact: true });
  await strip.getByRole("button").filter({ hasText: CHIEF }).click();
  await panel.waitFor();
  const thread = panel.getByRole("article", { name: RUNNING, exact: true });
  await thread.getByText("openbot/story-ticket-task").waitFor();
  await thread.getByRole("button", { name: t("tickets.panel.pause"), exact: true }).click();
  await thread.getByText(t("tickets.thread.paused"), { exact: true }).waitFor();
  await thread.getByRole("button", { name: t("tickets.panel.resume"), exact: true }).click();
  await thread.getByRole("button", { name: t("tickets.panel.pause"), exact: true }).waitFor();
  await screenshot(page, "agent-panel");
  await thread.getByRole("button", { name: t("tickets.panel.stop"), exact: true }).click();
  await thread.getByText(t("tickets.thread.idle"), { exact: true }).waitFor();
  assert.equal(await thread.getByRole("button", { name: t("tickets.panel.stop"), exact: true }).count(), 0);
  report.steps.push("The strip opens the agent panel; Pause, Resume and Stop change the thread.");

  // The agent moves its own ticket: the stopped thread puts it back in Backlog with the failure line.
  await card(column(page, "tickets.status.backlog"), RUNNING)
    .getByText(sourceText("error.agent.boardTickets.threadStopped"), { exact: true })
    .waitFor();
  report.steps.push("Stop puts the thread's ticket back in Backlog with the failure line, with no click.");

  // Open ticket shows the drawer of the thread's ticket.
  await thread.getByRole("button", { name: t("tickets.panel.openTicket"), exact: true }).click();
  const drawer = page.getByRole("complementary", { name: RUNNING, exact: true });
  await drawer.waitFor();

  // The stepper moves the ticket, and the step of the new column becomes the current one.
  const reviewStep = drawer.getByRole("button", { name: t("tickets.status.needsReview"), exact: true });
  await reviewStep.click();
  await drawer.getByRole("button", { name: t("tickets.status.needsReview"), exact: true, disabled: true }).waitFor();
  await drawer
    .getByText(t("tickets.event.moved", { from: t("tickets.status.backlog"), to: t("tickets.status.needsReview") }), {
      exact: true,
    })
    .waitFor();
  await drawer.getByRole("button", { name: t("tickets.status.running"), exact: true }).click();
  await drawer.getByRole("button", { name: t("tickets.status.running"), exact: true, disabled: true }).waitFor();
  report.steps.push("The stepper moves the ticket and records each move in the activity.");

  // Open issue, and the steer box: the text goes to the thread and into the activity.
  await drawer.getByRole("button", { name: t("tickets.drawer.openIssue"), exact: true }).click();
  const steer = drawer.getByRole("textbox", { name: t("tickets.drawer.steer"), exact: true });
  await steer.fill(STEER);
  await drawer.getByRole("button", { name: t("tickets.drawer.send"), exact: true }).click();
  await drawer.getByText(STEER, { exact: true }).waitFor();
  assert.equal(await steer.inputValue(), "");
  await screenshot(page, "drawer");
  await drawer.getByRole("button", { name: t("common.close"), exact: true }).click();
  await drawer.waitFor({ state: "detached" });
  report.steps.push("Open issue works, and a steer message goes to the thread and into the activity.");

  // The agent picker and Start now on a backlog ticket: the ticket gets a work thread.
  await card(column(page, "tickets.status.backlog"), BACKLOG).click();
  const backlogDrawer = page.getByRole("complementary", { name: BACKLOG, exact: true });
  await backlogDrawer.waitFor();
  await backlogDrawer.getByRole("button", { name: t("tickets.new.agent"), exact: true }).click();
  await page.getByRole("menuitemradio").filter({ hasText: SALES }).click();
  await backlogDrawer.getByText(t("tickets.drawer.agent", { name: SALES }), { exact: true }).waitFor();
  await backlogDrawer.getByRole("button", { name: t("tickets.new.start"), exact: true }).click();
  await backlogDrawer.getByRole("button", { name: t("tickets.drawer.openThread"), exact: true }).waitFor();
  await backlogDrawer.getByRole("textbox", { name: t("tickets.drawer.steer"), exact: true }).waitFor();
  assert.equal(await backlogDrawer.getByRole("button", { name: t("tickets.new.start"), exact: true }).count(), 0);
  await backlogDrawer.getByRole("button", { name: t("common.close"), exact: true }).click();
  report.steps.push("The agent picker assigns the ticket, and Start now gives it a work thread.");

  // Delete asks first, then removes the ticket.
  await card(column(page, "tickets.status.backlog"), UNASSIGNED).click();
  const unassignedDrawer = page.getByRole("complementary", { name: UNASSIGNED, exact: true });
  await unassignedDrawer.getByText(t("tickets.new.needsAgent"), { exact: true }).waitFor();
  await unassignedDrawer.getByRole("button", { name: t("common.delete"), exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByText(t("tickets.drawer.deleteTitle"), { exact: true }).waitFor();
  await confirm.getByRole("button", { name: t("common.delete"), exact: true }).click();
  await unassignedDrawer.waitFor({ state: "detached" });
  await card(page, UNASSIGNED).waitFor({ state: "detached" });
  await recordErrorToasts(page, "Delete");
  report.steps.push("Delete asks for a confirmation and removes the ticket.");

  // With no drawer open, the agent panel shows again. Closing it leaves New ticket with no agent.
  await panel.getByRole("button", { name: t("common.close"), exact: true }).click();
  await panel.waitFor({ state: "detached" });

  // New ticket: Cancel closes the dialog; Add to backlog adds a ticket; Start now starts one.
  const newTicket = page.getByRole("button", { name: t("tickets.new"), exact: true });
  const dialog = page.getByRole("dialog", { name: t("tickets.new"), exact: true });
  await newTicket.click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: t("common.cancel"), exact: true }).click();
  await dialog.waitFor({ state: "detached" });

  await newTicket.click();
  await dialog.getByRole("textbox", { name: t("tickets.new.name") }).fill(ADDED);
  await dialog.getByRole("textbox", { name: t("tickets.new.details") }).fill("A switch in the appearance settings.");
  await dialog.getByRole("button", { name: t("tickets.new.add"), exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await card(column(page, "tickets.status.backlog"), ADDED).waitFor();

  await newTicket.click();
  await dialog.getByRole("textbox", { name: t("tickets.new.name") }).fill(STARTED);
  assert.equal(await dialog.getByRole("button", { name: t("tickets.new.start"), exact: true }).isDisabled(), true);
  await dialog.getByRole("button", { name: t("tickets.new.agent"), exact: true }).click();
  await page.getByRole("menuitemradio").filter({ hasText: CHIEF }).click();
  await screenshot(page, "new-ticket");
  await dialog.getByRole("button", { name: t("tickets.new.start"), exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await card(column(page, "tickets.status.running"), STARTED).waitFor();
  // Its agent moves it: when the mock thread ends its turn, the ticket goes to Needs review by itself.
  await card(column(page, "tickets.status.needsReview"), STARTED).waitFor();
  await screenshot(page, "needs-review");
  report.steps.push(
    "New ticket cancels, adds a ticket to the backlog, and starts a ticket with an agent, which moves it from Running to Needs review.",
  );

  // A card that waits for review has Approve and Changes (#188). Neither opens the drawer.
  const reviewCard = column(page, "tickets.status.needsReview").locator(".tickets-card").filter({ hasText: STARTED });
  await reviewCard.getByText(t("tickets.step.waiting"), { exact: true }).waitFor();
  await reviewCard.getByRole("button", { name: t("tickets.card.changes"), exact: true }).click();
  const changesDialog = page.getByRole("dialog", { name: t("tickets.changes.title"), exact: true });
  await changesDialog.waitFor();
  assert.equal(await page.getByRole("complementary", { name: STARTED, exact: true }).count(), 0);
  await changesDialog.getByRole("button", { name: t("common.cancel"), exact: true }).click();
  await changesDialog.waitFor({ state: "detached" });
  await reviewCard.getByRole("button", { name: t("tickets.card.approve"), exact: true }).click();
  await card(column(page, "tickets.status.done"), STARTED).waitFor();
  assert.equal(await page.getByRole("complementary", { name: STARTED, exact: true }).count(), 0);
  report.steps.push("Changes opens its dialog and Approve moves the ticket to Done; neither opens the drawer.");

  // Raven team jobs: each job has its own ticket and one ticket per role, assigned to the role's agent.
  // The running job's Builder works and its Reviewer waits; the queued job's tickets wait in Queued.
  const running = column(page, "tickets.status.running");
  const backlog = column(page, "tickets.status.backlog");
  const queued = column(page, "tickets.status.queued");
  await jobCard(running, TEAM_JOB).waitFor();
  await card(running, `Builder: ${TEAM_JOB}`).waitFor();
  await card(backlog, `Reviewer: ${TEAM_JOB}`).waitFor();
  await jobCard(queued, QUEUED_JOB).waitFor();
  await card(queued, `Builder: ${QUEUED_JOB}`).waitFor();
  await card(queued, `Reviewer: ${QUEUED_JOB}`).waitFor();
  report.steps.push(
    "A running and a queued team job each have a ticket and one ticket per role, in the right columns.",
  );

  // The job's drawer lists its role tickets with their agents; a role ticket opens and links back to the job.
  await jobCard(running, TEAM_JOB).click();
  const jobDrawer = page.getByRole("complementary", { name: TEAM_JOB, exact: true });
  await jobDrawer.getByRole("heading", { name: t("tickets.drawer.roleTickets"), exact: true }).waitFor();
  const builderRow = jobDrawer.getByRole("button").filter({ hasText: `Builder: ${TEAM_JOB}` });
  await builderRow.getByText(t("tickets.status.running"), { exact: true }).waitFor();
  await jobDrawer
    .getByRole("button")
    .filter({ hasText: `Reviewer: ${TEAM_JOB}` })
    .getByText(t("tickets.status.backlog"), { exact: true })
    .waitFor();
  await screenshot(page, "team-job-drawer");
  await builderRow.click();
  const builderDrawer = page.getByRole("complementary", { name: `Builder: ${TEAM_JOB}`, exact: true });
  await builderDrawer.getByText(t("tickets.drawer.agent", { name: CHIEF }), { exact: true }).waitFor();
  await builderDrawer.getByRole("button", { name: t("tickets.drawer.openTeamJob"), exact: true }).click();
  await jobDrawer.waitFor();
  await jobDrawer.getByRole("button", { name: t("common.close"), exact: true }).click();
  await jobDrawer.waitFor({ state: "detached" });
  report.steps.push("The job's drawer lists its role tickets; a role ticket shows its role agent and opens its job.");

  // The tickets move with the job, with no click on the board. The team page's Stop is covered by
  // scripts/raven-team-e2e.ts; here the same preview call stops the running job. Its ticket goes back to
  // Backlog with the reason, and the queued job takes the free slot: its tickets leave Queued.
  await page.evaluate(`window.openbot.ravenTeam.stop(${JSON.stringify(TEAM_JOB_ID)})`);
  await jobCard(backlog, TEAM_JOB)
    .getByText(sourceText("error.agent.boardTickets.teamJobStopped"), { exact: true })
    .waitFor();
  await jobCard(running, QUEUED_JOB).waitFor();
  await card(running, `Builder: ${QUEUED_JOB}`).waitFor();
  await card(backlog, `Reviewer: ${QUEUED_JOB}`).waitFor();
  assert.equal(await card(queued, QUEUED_JOB).count(), 0);
  await screenshot(page, "team-job-stopped");
  report.steps.push(
    "Stopping a team job moves its tickets to Backlog with the reason, and the queued job's tickets move out of Queued.",
  );

  // Open thread leaves the page for the agent's chat. The steered thread may have moved the ticket.
  await card(page, RUNNING).first().click();
  await page
    .getByRole("complementary", { name: RUNNING, exact: true })
    .getByRole("button", { name: t("tickets.drawer.openThread"), exact: true })
    .click();
  await page.getByRole("region", { name: t("tickets.strip.label"), exact: true }).waitFor({ state: "detached" });
  await screenshot(page, "thread");
  report.steps.push("Open thread opens the agent's chat.");

  assert.deepEqual(report.errors, [], "The page threw an error.");
  assert.deepEqual(report.appErrors, [], "The app showed an error toast after an action that worked.");
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
