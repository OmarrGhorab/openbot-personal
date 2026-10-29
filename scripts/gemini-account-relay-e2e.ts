// Adds a second Gemini account on a joined server through the user's own browser, against a mock host
// that serves the account relay routes with the real frozen codecs. The client is the real relay of the
// browser client (`webProviderRelay`). Checks that on a host with `provider-account-relay-v2` Add
// account for Gemini opens the relay dialog, that the start goes to the v2 route, that pasting the
// address the browser ends on completes the sign-in in a folder of its own while the first account
// stays signed in, and that a host with only `provider-account-relay-v1` asks for a host update for
// Gemini, whose page Google refuses in the host's live view, and keeps the v1 route for Codex and
// Claude. `bun scripts/gemini-account-relay-e2e.ts`.
// Writes .openbot-build/gemini-account-relay-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import {
  PROVIDER_ACCOUNT_RELAY_CODECS,
  PROVIDER_ACCOUNT_RELAY_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-relay-v1";
import {
  PROVIDER_ACCOUNT_RELAY_V2_CODECS,
  PROVIDER_ACCOUNT_RELAY_V2_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-relay-v2";
import { SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { providerAccountSignInMethod } from "../src/renderer/src/features/provider-updates/provider-connect-route";
import { accountRelayProviders, webProviderRelay } from "../src/renderer/src/features/web-client/web-provider-relay";

const OUT = resolve(import.meta.dirname, "../.openbot-build/gemini-account-relay-e2e");
const SERVER_ID = "joined-server";
const STATE = "fake-google-state";
const CALLBACK = "http://localhost:51121/oauth2callback";
const GOOGLE_PAGE = `https://accounts.google.com/o/oauth2/v2/auth?client_id=fake&redirect_uri=${encodeURIComponent(CALLBACK)}&state=${STATE}`;

/** A text field of a JSON body, or a failed check. */
function textField(value: unknown, name: string): string {
  const entry =
    typeof value === "object" && value !== null ? Object.entries(value).find(([key]) => key === name) : null;
  assert.ok(entry && typeof entry[1] === "string", `${name} is missing`);
  return entry[1];
}

interface MockAccount {
  id: string;
  home: string;
  signedIn: boolean;
}

interface MockFlow {
  provider: string;
  accountId: string;
  query: string | null;
}

/**
 * A joined server that holds one signed-in Gemini account. Each start validates its body with the
 * route's own frozen codec, as the host's Team API does, and a new account gets its own folder.
 */
function mockHost(capabilities: ReadonlySet<string>) {
  const accounts: MockAccount[] = [{ id: "first", home: "/home/host/.gemini", signedIn: true }];
  const flows = new Map<string, MockFlow>();
  const calls: { path: string; body: unknown }[] = [];
  const opened: string[] = [];

  function start(path: string, body: unknown) {
    const v2 = path === PROVIDER_ACCOUNT_RELAY_V2_ROUTES.start;
    if (!capabilities.has(v2 ? "provider-account-relay-v2" : "provider-account-relay-v1"))
      throw new Error("The host does not relay this sign-in.");
    const codec = (v2 ? PROVIDER_ACCOUNT_RELAY_V2_CODECS : PROVIDER_ACCOUNT_RELAY_CODECS).get(path);
    assert.ok(codec);
    const provider = textField(codec.request(body), "provider");
    const id = `account-${accounts.length + 1}`;
    accounts.push({ id, home: `/home/host/.openbot/provider-accounts/${provider}/${id}`, signedIn: false });
    const flowId = `flow-${flows.size + 1}`;
    flows.set(flowId, { provider, accountId: id, query: null });
    return codec.response(200, { flowId, expiresAt: Date.now() + 600_000 });
  }

  function flowOf(body: unknown): [string, MockFlow] {
    const flowId = textField(body, "flowId");
    const flow = flows.get(flowId);
    assert.ok(flow, `unknown flow ${flowId}`);
    return [flowId, flow];
  }

  function status(flow: MockFlow) {
    const account = accounts.find((candidate) => candidate.id === flow.accountId);
    return {
      authorizeUrl: GOOGLE_PAGE,
      callback: { port: 51121, path: "/oauth2callback", state: STATE },
      result: account?.signedIn ? { error: null } : null,
    };
  }

  const request: TeamApiRequest = async (method, path, decode, body) => {
    assert.equal(method, "POST");
    calls.push({ path, body });
    if (path === PROVIDER_ACCOUNT_RELAY_ROUTES.start || path === PROVIDER_ACCOUNT_RELAY_V2_ROUTES.start)
      return decode(start(path, body));
    const [flowId, flow] = flowOf(body);
    if (path === SIGN_IN_RELAY_ROUTES.status) return decode(status(flow));
    if (path === SIGN_IN_RELAY_ROUTES.complete) {
      const query = new URLSearchParams(textField(body, "query"));
      assert.equal(query.get("state"), STATE);
      assert.ok(query.get("code"));
      flow.query = query.toString();
      const account = accounts.find((candidate) => candidate.id === flow.accountId);
      if (account) account.signedIn = true;
      return decode(status(flow));
    }
    if (path === SIGN_IN_RELAY_ROUTES.cancel) {
      flows.delete(flowId);
      return decode({});
    }
    throw new Error(`Unexpected route ${path}`);
  };

  return { accounts, calls, opened, request };
}

/** As `connectAccount` of the provider connection: a relayed provider opens the relay dialog. */
/** The dialog that Add account opens: the decision of the real `connectAccount`. */
function addAccountDialog(providers: readonly AgentProviderId[], provider: AgentProviderId) {
  return providerAccountSignInMethod(provider, providers);
}

async function waitForPage(relay: ReturnType<typeof webProviderRelay>, provider: AgentProviderId) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = await relay.relaySignInStatus(provider, SERVER_ID);
    if (status.result) throw new Error(status.result.error ?? "The sign-in ended before its page opened.");
    if (status.page) return status.page;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("The sign-in page did not open.");
}

async function waitForResult(relay: ReturnType<typeof webProviderRelay>, provider: AgentProviderId) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = await relay.relaySignInStatus(provider, SERVER_ID);
    if (status.result) return status.result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("The sign-in did not end.");
}

interface Report {
  passed: boolean;
  v2Dialog?: string | undefined;
  v2StartRoute?: string | undefined;
  page?: unknown;
  result?: { error: string | null } | undefined;
  accounts?: MockAccount[] | undefined;
  v1Dialog?: { antigravity: string; claude: string } | undefined;
  v1StartRoute?: string | undefined;
  noRelayDialog?: { antigravity: string; codex: string } | undefined;
}

const report: Report = { passed: false };
const savedWindow = globalThis.window;
let openedPages: string[] = [];
// The relay of the browser client waits with `window.setTimeout` and opens the page with `window.open`.
Object.assign(globalThis, {
  window: {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    open: (url: string) => {
      openedPages.push(url);
      return null;
    },
  },
});

try {
  // 1. A host with `provider-account-relay-v2`: Add account for Gemini opens the relay dialog.
  const host = mockHost(
    new Set(["sign-in-relay-v1", "provider-accounts-v1", "provider-account-relay-v1", "provider-account-relay-v2"]),
  );
  const relay = webProviderRelay(
    () => host.request,
    () => true,
  );
  const providers = accountRelayProviders(true);
  report.v2Dialog = addAccountDialog(providers, "antigravity");
  assert.equal(report.v2Dialog, "relay");

  await relay.startAccountRelaySignIn({ provider: "antigravity", accountId: null }, SERVER_ID);
  report.v2StartRoute = host.calls[0]?.path;
  assert.equal(report.v2StartRoute, PROVIDER_ACCOUNT_RELAY_V2_ROUTES.start);

  const page = await waitForPage(relay, "antigravity");
  report.page = page;
  assert.equal(page.authorizeHost, "accounts.google.com");
  assert.equal(page.pasteable, true);
  openedPages = [];
  await relay.openRelaySignIn("antigravity", SERVER_ID);
  assert.deepEqual(openedPages, [GOOGLE_PAGE]);

  // 2. Pasting the address the browser ends on completes the sign-in.
  await assert.rejects(
    relay.pasteRelaySignIn({ provider: "antigravity", address: `${CALLBACK}?code=x&state=wrong` }, SERVER_ID),
  );
  await relay.pasteRelaySignIn(
    { provider: "antigravity", address: `${CALLBACK}?code=fake-code&state=${STATE}` },
    SERVER_ID,
  );
  const result = await waitForResult(relay, "antigravity");
  report.result = result;
  assert.equal(result.error, null);

  // 3. The first account stays signed in, and the second has a folder of its own.
  report.accounts = host.accounts;
  assert.equal(host.accounts.length, 2);
  const [first, second] = host.accounts;
  assert.ok(first && second);
  assert.equal(first.signedIn, true);
  assert.equal(second.signedIn, true);
  assert.notEqual(second.home, first.home);
  assert.ok(!host.calls.some((call) => call.path === SIGN_IN_RELAY_ROUTES.cancel));

  // Codex on the same host also starts on the v2 route.
  await relay.startAccountRelaySignIn({ provider: "codex", accountId: null }, SERVER_ID);
  assert.equal(host.calls.at(-1)?.path, PROVIDER_ACCOUNT_RELAY_V2_ROUTES.start);
  await relay.cancelRelaySignIn("codex", SERVER_ID);

  // 4. A host with only `provider-account-relay-v1`, such as a server on an upstream release: Google
  // refuses the host's live view, so Add account for Gemini asks for a host update and opens no page;
  // Codex and Claude keep the v1 route.
  const oldHost = mockHost(new Set(["sign-in-relay-v1", "provider-accounts-v1", "provider-account-relay-v1"]));
  const oldRelay = webProviderRelay(
    () => oldHost.request,
    () => false,
  );
  const oldProviders = accountRelayProviders(false);
  // A host with no account relay at all keeps the live view for Codex, and still refuses it for Gemini.
  report.noRelayDialog = {
    antigravity: addAccountDialog([], "antigravity"),
    codex: addAccountDialog([], "codex"),
  };
  assert.deepEqual(report.noRelayDialog, { antigravity: "host-update", codex: "host-page" });
  report.v1Dialog = {
    antigravity: addAccountDialog(oldProviders, "antigravity"),
    claude: addAccountDialog(oldProviders, "claude"),
  };
  assert.deepEqual(report.v1Dialog, { antigravity: "host-update", claude: "relay" });
  await assert.rejects(oldRelay.startAccountRelaySignIn({ provider: "antigravity", accountId: null }, SERVER_ID));
  assert.equal(oldHost.calls.length, 0);
  await oldRelay.startAccountRelaySignIn({ provider: "claude", accountId: null }, SERVER_ID);
  report.v1StartRoute = oldHost.calls[0]?.path;
  assert.equal(report.v1StartRoute, PROVIDER_ACCOUNT_RELAY_ROUTES.start);
  await oldRelay.cancelRelaySignIn("claude", SERVER_ID);

  // The frozen v1 codec still refuses Gemini.
  const v1Codec = PROVIDER_ACCOUNT_RELAY_CODECS.get(PROVIDER_ACCOUNT_RELAY_ROUTES.start);
  assert.ok(v1Codec);
  assert.throws(() => v1Codec.request({ provider: "antigravity", accountId: null }));

  report.passed = true;
} finally {
  Object.assign(globalThis, { window: savedWindow });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
// The relays poll the mock host on timers; nothing else keeps the process.
process.exit(0);
