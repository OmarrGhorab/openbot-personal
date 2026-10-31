// Runs one command step and one file-change step end to end through the Changes panel's data
// path: the backend builds `turn-step` events (redacting the command), the preload decoder accepts
// them, the renderer's live-step store accumulates them, the stored trace keeps them for the thread
// files list, and the diff endpoint reads the working-tree diff. `bun scripts/turn-changes-panel-e2e.ts`.
// Writes .openbot-build/turn-changes-panel-e2e/report.json.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentEvent,
  type ConversationSnapshot,
  isAgentEvent,
  isTurnFileDiffResult,
  isTurnFilesResult,
  parseTurnFileDiffInput,
  parseTurnFilesInput,
  type TurnChangedFile,
} from "@openbot/contracts/ipc";
import { buildTurnStepEvent, TurnStepFileBudget, turnStepFiles } from "../src/backend/agent/turn-step-event";
import type { ThreadItem } from "../src/backend/protocol";
import { collectTurnFiles, readWorkspaceFileDiff } from "../src/main/turn-file-diff";
import { type TurnLiveSteps, upsertTurnLiveSteps } from "../src/renderer/src/features/conversation/turn-live-steps";

const OUT = resolve(import.meta.dirname, "../.openbot-build/turn-changes-panel-e2e");
const SECRET = "sk-ant-e2e-fake-token-000000000000000000";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? "ok" : "FAIL"} ${name} — ${detail}\n`);
}

function runGit(workspace: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    execFile("git", args, { cwd: workspace, timeout: 30_000 }, (error) => (error ? fail(error) : done()));
  });
}

const AGENT_ID = "agent-e2e";
const THREAD_ID = "thread-e2e";
const TURN_ID = "turn-e2e";
const STARTED_AT = new Date("2026-10-30T10:00:00.000Z").toISOString();
const ENDED_AT = new Date("2026-10-30T10:00:05.000Z").toISOString();

function commandItem(completed: boolean): ThreadItem {
  return {
    type: "toolCall",
    id: "item-cmd",
    name: "Bash",
    command: `bun test --token ${SECRET}`,
    status: completed ? "completed" : "running",
    ...(completed ? { exitCode: 0 } : {}),
  };
}

function fileItem(completed: boolean): ThreadItem {
  return {
    type: "toolCall",
    id: "item-edit",
    name: "Write",
    command: "write",
    filePaths: ["/workspace/notes.md", "/workspace/plan.md"],
    status: completed ? "completed" : "running",
  };
}

const events: AgentEvent[] = [];
let live: TurnLiveSteps = {};
const budget = new TurnStepFileBudget();

function emitTurn(item: ThreadItem, completed: boolean, text: string): void {
  const kind = item.id === "item-cmd" ? "command" : "file-change";
  const event = buildTurnStepEvent({
    agentId: AGENT_ID,
    threadId: THREAD_ID,
    turnId: TURN_ID,
    item,
    text,
    completed,
    startedAt: item.id === "item-cmd" && completed ? STARTED_AT : new Date().toISOString(),
    endedAt: completed ? ENDED_AT : null,
    files: kind === "file-change" ? budget.take(TURN_ID, turnStepFiles(item)) : [],
  });
  if (event?.type !== "turn-step" || !isAgentEvent(event)) {
    check(`turn-step ${item.id} ${completed ? "done" : "running"}`, false, "the backend built no decodable event.");
    return;
  }
  events.push(event);
  const startedAt = event.startedAt;
  live = upsertTurnLiveSteps(live, TURN_ID, {
    id: event.stepId,
    kind: event.kind,
    status: event.status,
    text: event.text,
    ...(event.command === undefined ? {} : { command: event.command }),
    ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
    ...(event.files === undefined ? {} : { files: event.files }),
    at: Date.parse(event.endedAt ?? startedAt),
  });
  check(
    `turn-step ${item.id} ${completed ? "done" : "running"}`,
    true,
    `${event.kind}/${event.status} decodes and accumulates.`,
  );
}

const workspace = await mkdtemp(join(tmpdir(), "openbot-changes-e2e-"));
try {
  await mkdir(OUT, { recursive: true });

  // The turn: a command with a token, then a file edit, each running and done.
  emitTurn(commandItem(false), false, "Checking the work…");
  emitTurn(commandItem(true), true, "Checked the work.");
  emitTurn(fileItem(false), false, "Making the requested changes…");
  emitTurn(fileItem(true), true, "Making the requested changes…");

  const runningCommand = events.find((event) => event.type === "turn-step" && event.status === "running");
  check(
    "command redaction",
    runningCommand?.type === "turn-step" &&
      (runningCommand.command?.includes(SECRET) ?? true) === false &&
      (runningCommand.command?.includes("[redacted]") ?? false),
    "the running command carries [redacted] instead of the token.",
  );

  const doneEdit = events.find(
    (event) => event.type === "turn-step" && event.kind === "file-change" && event.status === "done",
  );
  check(
    "file-change files",
    doneEdit?.type === "turn-step" &&
      (doneEdit.files?.map((file) => file.path).join(",") ?? "") === "/workspace/notes.md,/workspace/plan.md",
    "the done file change names both files.",
  );

  const liveSteps = live[TURN_ID] ?? [];
  check("live steps", liveSteps.length === 2, `${liveSteps.length} steps kept, one per item id.`);

  // The trace the host stores on the finished turn, and the thread files list over it.
  const files: TurnChangedFile[] = [];
  for (const event of events) {
    if (event.type !== "turn-step" || event.kind !== "file-change" || event.status !== "done") continue;
    for (const file of event.files ?? []) files.push({ ...file });
  }
  const snapshot: ConversationSnapshot = {
    agentId: AGENT_ID,
    threadId: THREAD_ID,
    activeTurnId: null,
    revision: 2,
    messages: [
      {
        id: `${TURN_ID}:answer`,
        turnId: TURN_ID,
        author: "assistant",
        text: "Done.",
        createdAt: ENDED_AT,
        status: "completed",
        trace: {
          startedAt: STARTED_AT,
          endedAt: ENDED_AT,
          steps: events
            .filter((event) => event.type === "turn-step" && event.status === "done")
            .map((event) => {
              if (event.type !== "turn-step") throw new Error("unreachable");
              return {
                id: event.stepId,
                kind: "tool" as const,
                text: event.text,
                startedAt: event.startedAt,
                endedAt: event.endedAt ?? null,
                ...(event.command === undefined ? {} : { command: event.command }),
                ...(event.files === undefined ? {} : { files: event.files }),
              };
            }),
        },
      },
    ],
  };
  const listed = collectTurnFiles(AGENT_ID, snapshot, TURN_ID);
  check(
    "thread files list",
    isTurnFilesResult(listed) && listed.files.length === 2 && listed.turnId === TURN_ID,
    `the panel lists: ${listed.files.map((file) => file.path).join(", ")}.`,
  );

  // The diff endpoint over a real checkout.
  let git = true;
  try {
    await runGit(workspace, ["init", "-q"]);
    await writeFile(join(workspace, "notes.md"), "# Notes\n\nold line\n");
    await runGit(workspace, ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", "add", "."]);
    await runGit(workspace, ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", "commit", "-qm", "seed"]);
    await writeFile(join(workspace, "notes.md"), "# Notes\n\nnew line\nadded line\n");
  } catch {
    git = false;
  }
  if (git) {
    const diff = await readWorkspaceFileDiff(join(workspace, "notes.md"));
    check(
      "diff view",
      isTurnFileDiffResult(diff) && diff.diff.includes("-old line") && diff.diff.includes("+new line"),
      "the diff names the removed and added lines.",
    );
    check(
      "file view",
      (diff.content?.includes("added line") ?? false) && diff.path.endsWith("notes.md"),
      "the file text is current.",
    );
  } else {
    checks.push({ name: "diff view", ok: true, detail: "skipped: git is not available." });
    checks.push({ name: "file view", ok: true, detail: "skipped: git is not available." });
  }
  // Outside a checkout the diff stays empty and the file still shows.
  const plainDir = await mkdtemp(join(tmpdir(), "openbot-changes-e2e-plain-"));
  try {
    await writeFile(join(plainDir, "plain.md"), "# Plain\n");
    const plain = await readWorkspaceFileDiff(join(plainDir, "plain.md"));
    check(
      "diff outside git",
      isTurnFileDiffResult(plain) && plain.diff === "" && (plain.content?.includes("# Plain") ?? false),
      "an empty diff with the file text.",
    );
  } finally {
    await rm(plainDir, { recursive: true, force: true });
  }

  // Bad payloads fail closed at the main boundary.
  for (const [name, payload] of [
    ["list without agent", { turnId: TURN_ID }],
    ["diff without path", { agentId: AGENT_ID }],
    ["diff with overlong path", { agentId: AGENT_ID, path: `/${"x".repeat(5000)}` }],
  ] as const) {
    let failed = false;
    try {
      if (name.startsWith("list")) parseTurnFilesInput(payload);
      else parseTurnFileDiffInput(payload);
    } catch {
      failed = true;
    }
    check(`reject ${name}`, failed, "the main boundary refuses it.");
  }

  // The finished-turn summary row the panel minimizes to.
  const summary = `${liveSteps.length} steps · ${listed.files.length} files`;
  check("summary row", summary === "2 steps · 2 files", `the minimized line reads "${summary}".`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
const report = { passed: failed.length === 0, checks };
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
if (failed.length > 0) {
  process.stderr.write(`${failed.length} checks failed.\n`);
  process.exit(1);
}
process.stdout.write(`All ${checks.length} checks passed. Report: ${join(OUT, "report.json")}\n`);
