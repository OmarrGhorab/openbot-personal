// Drives the "create an MCP server for a system that has none" flow of issue #97 on the real modules:
// the openbot-mcp-server-creator skill, the MCP tools, McpGateway, the SQLite MCP store, the probe
// and the MCP approval preference store. The script plays the agent: it follows the skill steps for
// a small sample HTTP API, writes a stdio server in <home>/OpenBot/mcp-servers/<name>/, starts it
// once, registers it, tests it, calls one tool, and updates it without a duplicate. Then it checks
// the approval with the no-approval setting off and on. No provider or account is used.
// bun scripts/mcp-create-e2e.ts. Writes .openbot-build/mcp-create-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { McpGateway } from "../src/backend/agent/mcp-gateway";
import { handleMcpServerTool, type McpServerToolName, mcpServersFromGateway } from "../src/backend/agent/mcp-tools";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpServerStore } from "../src/backend/mcp-server-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { createAgentMcpChangesPreferenceStore } from "../src/main/agent-mcp-changes-preference-store";

const REPO = resolve(import.meta.dirname, "..");
const OUT = join(REPO, ".openbot-build/mcp-create-e2e");
const SKILL = join(REPO, "resources/managed-skills/openbot-mcp-server-creator/SKILL.md");
const SERVER_NAME = "sample-inventory";
const KEY_VARIABLE = "SAMPLE_INVENTORY_API_KEY";
/** The key of the sample API. The user enters it in Server settings; nothing the agent reads holds it. */
const API_KEY = `sample-key-${randomUUID()}`;
const ITEMS = [
  { id: "1", name: "Blue mug", stock: 12 },
  { id: "2", name: "Desk lamp", stock: 3 },
];
// The probe runs in this process. A proxy from the environment must not take the local addresses.
for (const name of ["NO_PROXY", "no_proxy"]) {
  process.env[name] = [process.env[name], "127.0.0.1", "localhost"].filter(Boolean).join(",");
}

/** The JSON of an MCP tool result, as the agent reads it. */
interface ToolAnswer {
  status?: string;
  error?: string;
  toolCount?: number;
  tools?: string[];
  servers?: Array<{ name: string; command?: string; environmentNames?: string[] }>;
  enabled?: boolean;
  removed?: boolean;
}

interface Call {
  name: string;
  tool: McpServerToolName;
  withoutApproval: boolean;
  approved: boolean;
  success: boolean;
  result: ToolAnswer;
  approvals: string[];
  notes: string[];
}

interface Step {
  name: string;
  detail: unknown;
}

/** A small REST API that needs a key: the system that has no MCP server. */
async function sampleApi(): Promise<{ url: string; requests: string[]; close: () => Promise<void> }> {
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    requests.push(`${request.method} ${path}`);
    const send = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.headers["x-api-key"] !== API_KEY) return send(401, { error: "missing or wrong x-api-key" });
    if (path === "/items") return send(200, ITEMS);
    const item = /^\/items\/([^/]+)$/u.exec(path)?.[1];
    const found = ITEMS.find((candidate) => candidate.id === item);
    return found ? send(200, found) : send(404, { error: "not found" });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** The server code the agent writes, as the skill says: secrets from the environment only. */
function serverSource(apiUrl: string, withCount: boolean): string {
  const countTool = withCount
    ? `
server.registerTool(
  "count_items",
  { description: "Count the items in the inventory. Read-only.", inputSchema: {} },
  async () => {
    const items = await api("/items");
    return text({ count: items.length });
  },
);
`
    : "";
  return `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = ${JSON.stringify(apiUrl)};
const KEY_VARIABLE = ${JSON.stringify(KEY_VARIABLE)};

async function api(path) {
  const key = process.env[KEY_VARIABLE];
  if (!key) throw new Error(\`\${KEY_VARIABLE} is not set. Enter it in Server settings, MCP.\`);
  const response = await fetch(\`\${API_URL}\${path}\`, { headers: { "x-api-key": key } });
  if (!response.ok) throw new Error(\`The inventory API answered \${response.status}.\`);
  return response.json();
}

function text(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

const server = new McpServer({ name: ${JSON.stringify(SERVER_NAME)}, version: "1.0.0" });

server.registerTool(
  "list_items",
  { description: "List the items in the inventory: id, name and stock. Read-only.", inputSchema: {} },
  async () => text(await api("/items")),
);

server.registerTool(
  "get_item",
  {
    description: "Get one inventory item by its id: id, name and stock. Read-only.",
    inputSchema: { id: z.string().describe("The item id, as list_items returns it.") },
  },
  async ({ id }) => text(await api(\`/items/\${encodeURIComponent(id)}\`)),
);
${countTool}
await server.connect(new StdioServerTransport());
`;
}

/** Writes the server folder as step 4 of the skill does. */
async function writeServer(folder: string, apiUrl: string, withCount: boolean): Promise<string> {
  await mkdir(folder, { recursive: true });
  const entry = join(folder, "server.mjs");
  const tools = ["list_items", "get_item", ...(withCount ? ["count_items"] : [])];
  await writeFile(entry, serverSource(apiUrl, withCount));
  await writeFile(
    join(folder, "package.json"),
    `${JSON.stringify({ name: SERVER_NAME, private: true, type: "module", dependencies: { "@modelcontextprotocol/sdk": "1.32.1", zod: "*" } }, null, 2)}\n`,
  );
  await writeFile(
    join(folder, "README.md"),
    `# ${SERVER_NAME}\n\nTools: ${tools.join(", ")}.\n\nEnvironment: \`${KEY_VARIABLE}\` (enter it in Server settings, MCP).\n`,
  );
  await writeFile(
    join(folder, "openbot-mcp.json"),
    `${JSON.stringify(
      {
        name: SERVER_NAME,
        system: apiUrl,
        systemType: "rest",
        transport: "stdio",
        command: "node",
        args: [entry],
        environment: [KEY_VARIABLE],
        tools,
      },
      null,
      2,
    )}\n`,
  );
  return entry;
}

/** Starts the server with a client, as step 5 of the skill and as an agent's provider does. */
async function withClient<A>(
  config: Pick<McpServerConfig, "command" | "args" | "workingDirectory" | "env">,
  use: (client: Client) => Promise<A>,
): Promise<A> {
  const client = new Client({ name: "mcp-create-e2e", version: "1" });
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: config.workingDirectory || undefined,
    env: { ...getDefaultEnvironment(), ...Object.fromEntries(config.env.map(({ key, value }) => [key, value])) },
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}

function toolText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if (!("content" in result) || !Array.isArray(result.content)) return "";
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-create-"));
const home = join(root, "home");
const folder = join(home, "OpenBot", "mcp-servers", SERVER_NAME);
const database = new OpenBotDatabase(join(root, "data"));
const api = await sampleApi();
const calls: Call[] = [];
const steps: Step[] = [];
const report: {
  passed: boolean;
  server: { name: string; folder: string; tools: string[] };
  steps: Step[];
  calls: Call[];
  apiRequests: string[];
  failures: string[];
} = {
  passed: false,
  server: { name: SERVER_NAME, folder: "<home>/OpenBot/mcp-servers/sample-inventory", tools: [] },
  steps,
  calls,
  apiRequests: api.requests,
  failures: [],
};

try {
  // 1. The skill that agents get.
  const skill = await readFile(SKILL, "utf8");
  assert.ok(skill.startsWith("---\nname: openbot-mcp-server-creator\n"), "the managed skill front matter");
  for (const rule of [
    "~/OpenBot/mcp-servers/<name>/",
    "environment variable",
    "openbot.save_mcp_server",
    "openbot.test_mcp_server",
    "needs_key",
    "openbot-mcp.json",
    "Never make a duplicate",
  ])
    assert.ok(skill.includes(rule), `the skill names ${rule}`);
  steps.push({ name: "skill", detail: { bytes: skill.length } });

  // 2-4. Read the system, choose stdio and TypeScript SDK, write the server in the fixed folder.
  const entry = await writeServer(folder, api.url, false);
  // Step 5 installs the dependencies; here they come from the repository instead of the network.
  await mkdir(join(folder, "node_modules", "@modelcontextprotocol"), { recursive: true });
  await symlink(
    join(REPO, "node_modules/@modelcontextprotocol/sdk"),
    join(folder, "node_modules/@modelcontextprotocol/sdk"),
  );
  await symlink(join(REPO, "node_modules/zod"), join(folder, "node_modules/zod"));
  for (const file of await readdir(folder)) {
    if (file === "node_modules") continue;
    const content = await readFile(join(folder, file), "utf8");
    assert.ok(!content.includes(API_KEY), `${file} holds no secret`);
  }
  const command = { command: "node", args: [entry], workingDirectory: folder, env: [] };

  // 5. Start it once with the command OpenBot will use, without the key: it must still list tools.
  const started = await withClient(command, async (client) => (await client.listTools()).tools.map(({ name }) => name));
  assert.deepEqual(started, ["list_items", "get_item"]);
  steps.push({ name: "start once", detail: { tools: started } });

  // 6. Register and test with the MCP tools.
  await runCauseEffect(database.initialize());
  const store = new McpServerStore(database);
  const gateway = new McpGateway({
    servers: store,
    credentials: NO_PROVIDER_CREDENTIALS,
    computerUseMcpServer: () => null,
    logger: createOpenBotLogger("agent-service", () => undefined),
    hooks: { emitError: () => undefined, refreshAllAgentRuntimes: () => Effect.void },
  });
  const tools = mcpServersFromGateway(gateway);
  const call = async (
    name: string,
    tool: McpServerToolName,
    args: unknown,
    options: { withoutApproval?: boolean; approved?: boolean } = {},
  ) => {
    const withoutApproval = options.withoutApproval ?? false;
    const approved = options.approved ?? true;
    const approvals: string[] = [];
    const notes: string[] = [];
    const response = await runCauseEffect(
      handleMcpServerTool(tools, {
        tool,
        arguments: args,
        withoutApproval,
        approve: (reason) =>
          Effect.sync(() => {
            approvals.push(reason);
            return approved;
          }),
        recordChange: (text) =>
          Effect.sync(() => {
            notes.push(text);
          }),
        requestSignIn: () => Effect.void,
      }),
    );
    const text = response.contentItems[0]?.type === "inputText" ? response.contentItems[0].text : "{}";
    const entry: Call = {
      name,
      tool,
      withoutApproval,
      approved,
      success: response.success,
      result: JSON.parse(text),
      approvals,
      notes,
    };
    calls.push(entry);
    return entry;
  };
  const rows = () => store.list().filter((config) => config.name === SERVER_NAME);
  const save = { name: SERVER_NAME, transport: "stdio", command: "node", args: [entry], workingDirectory: folder };

  const none = await call("check what exists", "list_mcp_servers", {});
  assert.deepEqual(none.result.servers, []);

  // Setting off: each change asks. A declined change saves nothing.
  const declined = await call("setting off: a declined save saves nothing", "save_mcp_server", save, {
    approved: false,
  });
  assert.equal(declined.success, false);
  assert.equal(declined.approvals.length, 1);
  assert.equal(declined.notes.length, 0);
  assert.equal(rows().length, 0);

  const saved = await call("setting off: an approved save registers the server", "save_mcp_server", save);
  assert.equal(saved.result.status, "ready");
  assert.deepEqual(saved.result.tools, ["list_items", "get_item"]);
  assert.equal(saved.approvals.length, 1, "setting off asks for approval");
  assert.match(saved.approvals[0] ?? "", /Every agent on this server/u);
  assert.equal(saved.notes.length, 0, "an approved change has its card, not a note");
  assert.equal(rows().length, 1);

  const tested = await call("test the server", "test_mcp_server", { name: SERVER_NAME });
  assert.equal(tested.result.status, "ready");
  assert.equal(tested.approvals.length, 0);

  // The user enters the key in Server settings, MCP.
  const row = rows()[0];
  assert.ok(row);
  store.save({ ...row, env: [{ key: KEY_VARIABLE, value: API_KEY }] });
  const listed = await call("the agent sees the variable name only", "list_mcp_servers", {});
  assert.deepEqual(listed.result.servers?.[0]?.environmentNames, [KEY_VARIABLE]);

  // Call one tool through the registered row, as the agent's provider does.
  const registered = rows()[0];
  assert.ok(registered);
  const missingKey = await withClient(command, (client) =>
    client.callTool({ name: "get_item", arguments: { id: "1" } }),
  );
  assert.match(
    toolText(missingKey),
    new RegExp(`${KEY_VARIABLE} is not set\\. Enter it in Server settings, MCP\\.`, "u"),
  );
  const item = await withClient(registered, (client) => client.callTool({ name: "get_item", arguments: { id: "2" } }));
  assert.deepEqual(JSON.parse(toolText(item)), ITEMS[1]);
  steps.push({ name: "call get_item", detail: JSON.parse(toolText(item)) });

  // Update: add a tool in the same folder, keep the row, test again. No second server.
  await writeServer(folder, api.url, true);
  const updated = await call("update: test the same server after the change", "test_mcp_server", { name: SERVER_NAME });
  assert.equal(updated.result.status, "ready");
  assert.deepEqual(updated.result.tools, ["list_items", "get_item", "count_items"]);
  assert.equal(rows().length, 1, "an update makes no duplicate");
  assert.deepEqual(rows()[0]?.env, [{ key: KEY_VARIABLE, value: API_KEY }], "an update keeps the key");
  const sameName = await call("update: save by the same name changes the row", "save_mcp_server", {
    name: SERVER_NAME,
    enabled: true,
  });
  assert.equal(sameName.result.status, "ready");
  assert.equal(rows().length, 1);
  report.server.tools = updated.result.tools ?? [];

  // Setting on, agent with Full access: no approval, and each change is noted in the conversation.
  const off = await call(
    "setting on: turn off without approval",
    "set_mcp_server_enabled",
    {
      name: SERVER_NAME,
      enabled: false,
    },
    { withoutApproval: true },
  );
  assert.equal(off.success, true);
  assert.equal(off.approvals.length, 0, "setting on asks nothing");
  assert.equal(off.notes.length, 1);
  assert.match(off.notes[0] ?? "", /^Turned off the MCP server sample-inventory without asking: node /u);
  assert.equal(rows()[0]?.enabled, false);
  const on = await call(
    "setting on: turn on without approval",
    "set_mcp_server_enabled",
    {
      name: SERVER_NAME,
      enabled: true,
    },
    { withoutApproval: true },
  );
  assert.equal(on.approvals.length, 0);
  assert.match(on.notes[0] ?? "", /^Turned on the MCP server sample-inventory/u);
  const removed = await call(
    "setting on: remove without approval",
    "remove_mcp_server",
    { name: SERVER_NAME },
    {
      withoutApproval: true,
    },
  );
  assert.equal(removed.success, true);
  assert.equal(removed.approvals.length, 0);
  assert.match(removed.notes[0] ?? "", /To undo, add it again in Server settings, MCP\./u);
  assert.ok(removed.notes[0]?.includes(entry), "the note keeps the command line for the undo");
  assert.equal(rows().length, 0);
  const added = await call("setting on: add without approval", "save_mcp_server", save, { withoutApproval: true });
  assert.equal(added.result.status, "ready");
  assert.equal(added.approvals.length, 0);
  assert.match(added.notes[0] ?? "", /^Added the MCP server sample-inventory without asking/u);
  assert.equal(rows().length, 1);

  // Setting off again: the next change asks at once. Servers that exist stay.
  const again = await call(
    "setting off again: the next change asks",
    "set_mcp_server_enabled",
    {
      name: SERVER_NAME,
      enabled: false,
    },
    { approved: false },
  );
  assert.equal(again.success, false);
  assert.equal(again.approvals.length, 1);
  assert.equal(again.notes.length, 0);
  assert.equal(rows()[0]?.enabled, true, "a declined change changes nothing");

  // The preference that drives `withoutApproval`: off by default, kept across a restart, off when broken.
  const preferenceFile = join(root, "openbot-agent-mcp-changes-v1.json");
  const first = createAgentMcpChangesPreferenceStore(preferenceFile);
  await runCauseEffect(first.load());
  assert.deepEqual(first.get(), { withoutApproval: false }, "off by default");
  await runCauseEffect(first.set({ withoutApproval: true }));
  const restarted = createAgentMcpChangesPreferenceStore(preferenceFile);
  await runCauseEffect(restarted.load());
  assert.deepEqual(restarted.get(), { withoutApproval: true }, "on is kept");
  await runCauseEffect(restarted.set({ withoutApproval: false }));
  assert.deepEqual(restarted.get(), { withoutApproval: false }, "off applies at once");
  await writeFile(preferenceFile, "{ not json");
  const broken = createAgentMcpChangesPreferenceStore(preferenceFile);
  await runCauseEffect(broken.load());
  assert.deepEqual(broken.get(), { withoutApproval: false }, "a broken file reads as off");
  steps.push({ name: "preference", detail: { default: false, kept: true, brokenReadsOff: true } });

  // Secrets never reach the agent: not in a result, an approval, or a note.
  const agentSaw = JSON.stringify(calls.map(({ result, approvals, notes }) => ({ result, approvals, notes })));
  assert.ok(!agentSaw.includes(API_KEY), "the API key reached the agent");
  assert.ok(api.requests.includes("GET /items/2"), "the tool call reached the sample API");
  report.passed = true;
} catch (error) {
  report.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  await api.close();
  database.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const text = `${JSON.stringify(report, null, 2)}\n`.replaceAll(root, "<tmp>");
  assert.ok(!text.includes(API_KEY), "the report holds no secret");
  await writeFile(join(OUT, "report.json"), text);
}

process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${calls.length} calls. Report: ${join(OUT, "report.json")}\n`);
if (!report.passed) {
  process.stderr.write(`${report.failures.join("\n")}\n`);
  process.exit(1);
}
