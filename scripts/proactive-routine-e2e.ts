// Checks the scheduled coding jobs of Autonomy 5 on the real scheduler, SQLite stores and mailbox.
// Each job is a routine that the renderer saves from a template: the instruction is the body of its
// skill in resources/autonomy-skills, with the front matter removed, and the schedule is weekly or
// monthly. The check creates the four templates through the IPC decoder (`parseCreateRoutine`), as
// the one-click button does, then moves the clock and runs the due pass.
//
// It proves that a due template queues one run with its skill instruction, that a second pass at
// the same time does not repeat it, that a spent provider plan skips the run, and that a paused
// template queues nothing. It does not start a provider or open a pull request: the queued
// delivery is cancelled at the end of each step, as a user does in the queue.
//
// Run: `bun scripts/proactive-routine-e2e.ts`. Writes .openbot-build/proactive-routine-e2e/report.json.

import { setSystemTime } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Routine } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";
import { parseCreateRoutine, parseUpdateRoutine } from "../src/main/ipc/agent-inputs";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "proactive-routine-e2e");
const STEP_DEADLINE_MS = 15_000;
// Monday 2026-11-02 is a Monday, and Sunday 2026-11-01 is the day before it.
const SUNDAY = "2026-11-01";
const MONDAY = "2026-11-02";
const at = (day: string, time: string) => new Date(`${day}T${time}:00.000Z`);

const SKILLS = [
  { slug: "update-dependencies", name: "Update dependencies", schedule: { kind: "weekly", weekday: 1, time: "09:00" } },
  { slug: "triage-flaky-tests", name: "Triage flaky tests", schedule: { kind: "weekly", weekday: 2, time: "09:00" } },
  { slug: "clean-todos", name: "Clean old TODOs", schedule: { kind: "monthly", day: 1, time: "09:00" } },
  { slug: "triage-stale-issues", name: "Triage stale issues", schedule: { kind: "weekly", weekday: 5, time: "09:00" } },
] as const;

/** The routine instruction is the skill body. The renderer does the same in `routine-templates.ts`. */
function skillBody(slug: string): { name: string; body: string } {
  const markdown = readFileSync(join(ROOT, "resources", "autonomy-skills", slug, "SKILL.md"), "utf8");
  const match = /^---\r?\nname: (.+)\r?\ndescription: (.+)\r?\n---\r?\n/u.exec(markdown);
  assert.ok(match, `${slug} has front matter with a name and a description.`);
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "").trim();
  return { name: match[1] ?? "", body };
}

interface Fixture {
  database: OpenBotDatabase;
  mailbox: MailboxStore;
  scheduler: RoutineScheduler;
  runs: AgentRoutineStore;
  agentId: string;
  errors: string[];
  limited: Set<string>;
  close(): void;
}

async function openFixture(root: string): Promise<Fixture> {
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  let conversation: ConversationRuntime | undefined;
  try {
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent =
      store.list()[0] ??
      (await runCauseEffect(
        store.createAgent({
          name: "Coding fixture",
          description: "Synthetic coding agent",
          avatarSeed: "proactive-routine",
          avatarHue: null,
        }),
      ));
    const errors: string[] = [];
    const limited = new Set<string>();
    conversation = new ConversationRuntime(
      store,
      () => {},
      () => store.list(),
    );
    const runtime = conversation;
    const timer = new RoutineTimer(
      () => [],
      () => false,
      (code) => errors.push(code),
    );
    const waits = new AgentWaits({
      store: new AgentWaitStore({ database }),
      mailbox,
      hooks: { emit: () => {}, ownsRoutine: () => true, hasRoutine: () => true, requireKnownAgent: () => {} },
    });
    const scheduler = new RoutineScheduler({
      store,
      mailbox,
      conversation: runtime,
      timer,
      waits,
      timezone: () => "UTC",
      hooks: {
        emit: () => {},
        emitError: (code) => errors.push(code),
        emitQueue: () => {},
        scheduleDrain: () => {},
        interrupt: () => Effect.void,
        awaitDrain: () => undefined,
        syncMailboxMessages: () => {},
        listAgents: () => store.list(),
        excludedAgents: () => new Set(),
        isRunning: () => false,
        usageLimited: (agentId) => limited.has(agentId),
      },
    });
    return {
      database,
      mailbox,
      scheduler,
      runs: new AgentRoutineStore(database),
      agentId: agent.id,
      errors,
      limited,
      close() {
        timer.dispose();
        runtime.dispose();
        database.close();
      },
    };
  } catch (error) {
    conversation?.dispose();
    database.close();
    throw error;
  }
}

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; skills: { slug: string; name: string; bytes: number }[]; steps: Step[] } = {
  passed: false,
  skills: [],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // A bound on failure only: each check awaits its own operation.
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-proactive-routine-"));
let fixture: Fixture | undefined;

function current(): Fixture {
  assert.ok(fixture, "The fixture is open.");
  return fixture;
}

function deliveries(id: string): number {
  return current()
    .mailbox.conversationMessages(current().agentId)
    .filter((message) => message.routine?.routineId === id).length;
}

function runs(id: string): Array<{ status: string; instruction: string; scheduledFor: string }> {
  return current().runs.listRuns(current().agentId, id, 50, true);
}

/** Saves a template the way the one-click button does: active, skip at a spent plan, skip missed. */
function scheduleTemplate(slug: string, schedule: unknown): Routine {
  // The name is the display name the renderer uses, not the skill's folder name.
  const name = SKILLS.find((skill) => skill.slug === slug)?.name ?? slug;
  const { body } = skillBody(slug);
  return current().scheduler.create(
    parseCreateRoutine({
      agentId: current().agentId,
      name,
      instruction: body,
      active: true,
      timezone: "UTC",
      schedule,
      limitPolicy: "skip",
      missedPolicy: "skip",
    }),
    { recordConversationEvent: false },
  );
}

async function cancelQueued(): Promise<void> {
  const { mailbox, agentId } = current();
  for (const deliveryId of mailbox.queuedDeliveryIds(agentId))
    await runCauseEffect(mailbox.cancel(agentId, deliveryId));
}

async function pass(now: Date): Promise<void> {
  await runCauseEffect(current().scheduler.processDue(now));
}

try {
  await step("Each skill file has front matter and an instruction body", async () => {
    for (const skill of SKILLS) {
      const { name, body } = skillBody(skill.slug);
      assert.equal(name, skill.slug, "The front matter name is the folder name.");
      assert.ok(body.length > 200, `${skill.slug} has an instruction body.`);
      assert.ok(!body.startsWith("---"), "The front matter is removed from the instruction.");
      report.skills.push({ slug: skill.slug, name, bytes: Buffer.byteLength(body) });
    }
    return report.skills;
  });

  await step("A one-click template saves as an active weekly routine and waits for its time", async () => {
    setSystemTime(at(SUNDAY, "08:00"));
    fixture = await openFixture(root);
    const created = scheduleTemplate("update-dependencies", SKILLS[0].schedule);
    assert.equal(created.active, true);
    assert.equal(created.trigger.nextRunAt, at(MONDAY, "09:00").toISOString());
    assert.equal(deliveries(created.id), 0, "Nothing is queued before the time.");
    return { id: created.id, nextRunAt: created.trigger.nextRunAt };
  });

  await step("A due template queues one run with its skill instruction, once", async () => {
    const routine = current()
      .scheduler.list(current().agentId)
      .find((row) => row.name === "Update dependencies");
    assert.ok(routine, "The template routine exists.");
    setSystemTime(at(MONDAY, "09:00"));
    await pass(at(MONDAY, "09:00"));
    assert.equal(deliveries(routine.id), 1, "The due pass queues one delivery.");
    const [run] = runs(routine.id);
    assert.ok(run, "The due pass records one run.");
    assert.ok(run.instruction.includes("# Update dependencies"), "The run carries the skill instruction.");
    assert.ok(run.instruction.includes("routine_no_update"), "The run carries the quiet-run tool name.");
    await pass(at(MONDAY, "09:00"));
    assert.equal(deliveries(routine.id), 1, "A second pass at the same time does not repeat the run.");
    await cancelQueued();
    assert.deepEqual(current().errors, []);
    return {
      deliveries: deliveries(routine.id),
      nextRunAt: current()
        .scheduler.list(current().agentId)
        .find((row) => row.id === routine.id)?.trigger.nextRunAt,
    };
  });

  await step("A spent provider plan drops the template run and moves to the next occurrence", async () => {
    const routine = current()
      .scheduler.list(current().agentId)
      .find((row) => row.name === "Update dependencies");
    assert.ok(routine, "The template routine exists.");
    const nextMonday = at("2026-11-09", "09:00");
    assert.equal(routine.trigger.nextRunAt, nextMonday.toISOString());
    const before = deliveries(routine.id);
    current().limited.add(current().agentId);
    setSystemTime(nextMonday);
    await pass(nextMonday);
    current().limited.delete(current().agentId);
    assert.equal(deliveries(routine.id), before, "The spent plan queues no delivery.");
    assert.equal(runs(routine.id).length, 1, "The dropped occurrence records no run.");
    const advanced = current()
      .scheduler.list(current().agentId)
      .find((row) => row.id === routine.id);
    assert.equal(advanced?.trigger.nextRunAt, at("2026-11-16", "09:00").toISOString());
    return { deliveriesBefore: before, nextRunAt: advanced?.trigger.nextRunAt };
  });

  await step("A paused template queues nothing", async () => {
    setSystemTime(at(SUNDAY, "08:00"));
    const routine = scheduleTemplate("triage-stale-issues", SKILLS[3].schedule);
    assert.equal(routine.trigger.nextRunAt, at("2026-11-06", "09:00").toISOString());
    current().scheduler.update(
      parseUpdateRoutine({ agentId: current().agentId, routineId: routine.id, active: false }),
      { recordConversationEvent: false },
    );
    const friday = at("2026-11-06", "09:00");
    setSystemTime(friday);
    await pass(friday);
    assert.equal(deliveries(routine.id), 0, "A paused template is not queued.");
    return { active: false, deliveries: deliveries(routine.id) };
  });

  await step("Each template has its own schedule and instruction", async () => {
    setSystemTime(at(SUNDAY, "08:00"));
    const expected = [
      { slug: "triage-flaky-tests", name: "Triage flaky tests", schedule: SKILLS[1].schedule },
      { slug: "clean-todos", name: "Clean old TODOs", schedule: SKILLS[2].schedule },
    ];
    const created = expected.map((item) => ({ item, routine: scheduleTemplate(item.slug, item.schedule) }));
    for (const { item, routine } of created) {
      assert.equal(routine.name, item.name);
      assert.ok(routine.trigger.nextRunAt, "The template has a next run.");
    }
    const monthly = created.find((entry) => entry.item.slug === "clean-todos")?.routine;
    assert.equal(
      monthly?.trigger.nextRunAt,
      at(SUNDAY, "09:00").toISOString(),
      "The first of the month is Sunday 2026-11-01.",
    );
    const tuesday = created.find((entry) => entry.item.slug === "triage-flaky-tests")?.routine;
    assert.equal(tuesday?.trigger.nextRunAt, at("2026-11-03", "09:00").toISOString());
    return created.map(({ routine }) => ({ name: routine.name, nextRunAt: routine.trigger.nextRunAt }));
  });

  report.passed = true;
} finally {
  setSystemTime();
  fixture?.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
