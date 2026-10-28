// A Codex app-server stand-in for the question queue check (`scripts/question-queue-e2e.ts`). It answers
// the calls that the service makes, starts a turn for each `turn/start`, and finishes the turn with
// "Done." unless the message holds `QUESTION-CALL <<ARGS{json}ARGS>>`. Such a turn calls the tool that
// the JSON names, `__tool` is the tool and the other fields are its arguments. The turn then waits: it
// stays open until the app answers the call, as it does for `ask_user` when the user answers.
// It logs each tool result by turn id to the file in `FAKE_CODEX_LOG`. No model runs.
import { appendFileSync } from "node:fs";

const LOG = process.env.FAKE_CODEX_LOG ?? "";
const MODEL = "gpt-6-luna";
const CALL_MARK = "QUESTION-CALL";

/** The fields of a request that this fake reads. */
interface RequestParams {
  threadId?: string;
  turnId?: string;
  input?: { text?: string }[];
  developerInstructions?: string;
}

/** A line from the client: a request, a notification, or the answer to a tool call of this fake. */
interface ClientMessage {
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: unknown;
  params?: RequestParams;
}

/** Tool request id -> the turn that waits for its result. */
const waiting = new Map<string, { threadId: string; turnId: string }>();
let threads = 0;
let turns = 0;

function log(entry: unknown): void {
  if (LOG) appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
}

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function finish(threadId: string, turnId: string): void {
  const item = { type: "agentMessage", id: `message-${turnId}`, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
}

function startTurn(id: number | string, params: RequestParams): void {
  const threadId = params.threadId ?? "";
  const turnId = `turn-${process.pid}-${++turns}`;
  const text = (params.input ?? []).map((item) => item.text ?? "").join("\n");
  write({ id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
  write({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
  const match = text.includes(CALL_MARK) ? /<<ARGS([\s\S]*?)ARGS>>/.exec(text) : null;
  if (!match?.[1]) {
    setTimeout(() => finish(threadId, turnId), 20);
    return;
  }
  const requestId = `tool-${turnId}`;
  waiting.set(requestId, { threadId, turnId });
  const call: { __tool?: unknown } = JSON.parse(match[1]);
  const { __tool, ...args } = call;
  write({
    id: requestId,
    method: "item/tool/call",
    params: {
      threadId,
      turnId,
      callId: `call-${turnId}`,
      namespace: "openbot",
      tool: "tool_call",
      arguments: { name: `openbot.${String(__tool)}`, arguments: args },
    },
  });
}

function answer(message: ClientMessage & { id: number | string; method: string }): void {
  const params = message.params ?? {};
  switch (message.method) {
    case "initialize":
      write({ id: message.id, result: {} });
      return;
    case "account/read":
      write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
      return;
    case "account/rateLimits/read":
      write({
        id: message.id,
        result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null },
      });
      return;
    case "model/list":
      write({ id: message.id, result: { data: [{ model: MODEL, displayName: "GPT-6 Luna" }] } });
      return;
    case "plugin/list":
      write({ id: message.id, result: { marketplaces: [] } });
      return;
    case "config/read":
      write({ id: message.id, result: config });
      return;
    case "config/batchWrite":
      write({ id: message.id, result: {} });
      return;
    case "thread/start": {
      threads += 1;
      const threadId = `thread-${process.pid}-${threads}`;
      log({ kind: "thread/start", threadId, developerInstructions: params.developerInstructions ?? null });
      write({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
      return;
    }
    case "thread/resume":
      write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
      return;
    case "thread/unsubscribe":
      write({ id: message.id, result: { status: "Unsubscribed" } });
      return;
    case "thread/turns/list":
    case "thread/items/list":
      write({ id: message.id, result: { data: [], nextCursor: null } });
      return;
    case "thread/read":
      write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
      return;
    case "turn/start":
      startTurn(message.id, params);
      return;
    case "turn/interrupt":
      write({ id: message.id, result: {} });
      write({
        method: "turn/completed",
        params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } },
      });
      return;
    default:
      write({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
}

const config = {
  config: { mcp_servers: {} },
  layers: [
    {
      name: { type: "user", file: "/fake/.codex/config.toml", profile: null },
      version: "1",
      config: { mcp_servers: {} },
    },
  ],
};

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\n");
} else {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message: ClientMessage = JSON.parse(line);
        if (message.method && message.id !== undefined) {
          answer({ ...message, id: message.id, method: message.method });
        } else if (!message.method && message.id !== undefined && waiting.has(String(message.id))) {
          const turn = waiting.get(String(message.id));
          waiting.delete(String(message.id));
          if (turn) {
            log({ turnId: turn.turnId, result: message.result ?? null, error: message.error ?? null });
            finish(turn.threadId, turn.turnId);
          }
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
}
