// Checks the development account skip against the real central auth manager.
// Startup with the skip must sign in a local account, make no HTTP request, and leave a stored
// session file unchanged. A production-style manager must refuse the sign-in action. With the
// skip off, startup still calls the account service.
//
// Run: bun scripts/development-account-skip-e2e.ts
// It writes .openbot-build/development-account-skip-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CentralAuthManager } from "../src/main/central-auth-manager";
import {
  continueWithoutAccountAllowed,
  DEVELOPMENT_SKIP_ACCOUNT,
  startupSkipsAccountService,
} from "../src/main/development-account-skip";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "development-account-skip-e2e");
const STORED_SESSION = "stored-session-must-stay";

const requests: string[] = [];
const server = createServer((request, response) => {
  requests.push(request.url ?? "");
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ status: "ok" }));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object");
const apiUrl = `http://127.0.0.1:${address.port}`;
const root = await mkdtemp(join(tmpdir(), "openbot-dev-skip-account-"));

let decryptCalls = 0;
const cases: string[] = [];
let passed = false;
let error: string | undefined;

function manager(options: {
  skipAccountService?: boolean;
  allowContinueWithoutAccount?: boolean;
  storagePath: string;
}) {
  return new CentralAuthManager({
    apiUrl,
    storagePath: options.storagePath,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => {
      decryptCalls += 1;
      return value.toString();
    },
    startupRetryWindowMs: 300,
    startupRequestTimeoutMs: 100,
    startupRetryDelaysMs: [10],
    skipAccountService: options.skipAccountService === true,
    allowContinueWithoutAccount: options.allowContinueWithoutAccount === true,
  });
}

try {
  assert.equal(startupSkipsAccountService(undefined, null), false);
  assert.equal(startupSkipsAccountService("", null), false);
  assert.equal(startupSkipsAccountService("true", null), false);
  assert.equal(startupSkipsAccountService("1 ", null), false);
  assert.equal(startupSkipsAccountService("1", "host"), false);
  assert.equal(startupSkipsAccountService("1", "client"), false);
  assert.equal(startupSkipsAccountService("1", null), true);
  assert.equal(continueWithoutAccountAllowed("production"), false);
  assert.equal(continueWithoutAccountAllowed("dev"), true);
  assert.equal(continueWithoutAccountAllowed("preview"), true);
  cases.push("policy");

  const sessionPath = join(root, "session.bin");
  await writeFile(sessionPath, STORED_SESSION);
  const skipped = manager({ skipAccountService: true, storagePath: sessionPath });
  const events: string[] = [];
  skipped.on("changed", (state) => events.push(state.status));
  const signedIn = await runCauseEffect(skipped.initialize());
  assert.equal(signedIn.status, "signed_in");
  if (signedIn.status === "signed_in") {
    assert.deepEqual(signedIn.user, DEVELOPMENT_SKIP_ACCOUNT);
  }
  assert.deepEqual(events, ["signed_in"]);
  assert.equal(requests.length, 0);
  assert.equal(decryptCalls, 0);
  assert.equal(await readFile(sessionPath, "utf8"), STORED_SESSION);
  assert.equal((await runCauseEffect(skipped.refreshProfile())).status, "signed_in");
  assert.equal(requests.length, 0);
  await assert.rejects(() => runCauseEffect(skipped.updateName("Other")));
  assert.equal(skipped.getState().status, "signed_in");
  assert.equal(requests.length, 0);
  const signedOut = await runCauseEffect(skipped.logout());
  assert.equal(signedOut.status, "signed_out");
  assert.equal(await readFile(sessionPath, "utf8"), STORED_SESSION);
  const again = await runCauseEffect(skipped.initialize());
  assert.equal(again.status, "signed_in");
  assert.equal(requests.length, 0);
  assert.equal(decryptCalls, 0);
  assert.equal(await readFile(sessionPath, "utf8"), STORED_SESSION);
  await runCauseEffect(skipped.dispose());
  cases.push("skip-startup");

  const refusedPath = join(root, "refused.bin");
  await writeFile(refusedPath, STORED_SESSION);
  const decryptsBeforeRefuse = decryptCalls;
  const refused = manager({ allowContinueWithoutAccount: false, storagePath: refusedPath });
  await assert.rejects(() => runCauseEffect(refused.continueWithoutAccount()));
  assert.equal(refused.getState().status, "loading");
  assert.equal(decryptCalls, decryptsBeforeRefuse);
  assert.equal(await readFile(refusedPath, "utf8"), STORED_SESSION);
  await runCauseEffect(refused.dispose());
  cases.push("continue-refused");

  const acceptedPath = join(root, "accepted.bin");
  await writeFile(acceptedPath, STORED_SESSION);
  const decryptsBeforeAccept = decryptCalls;
  const accepted = manager({ allowContinueWithoutAccount: true, storagePath: acceptedPath });
  const continued = await runCauseEffect(accepted.continueWithoutAccount());
  assert.equal(continued.status, "signed_in");
  if (continued.status === "signed_in") assert.deepEqual(continued.user, DEVELOPMENT_SKIP_ACCOUNT);
  assert.equal(await readFile(acceptedPath, "utf8"), STORED_SESSION);
  assert.equal(decryptCalls, decryptsBeforeAccept);
  assert.equal((await runCauseEffect(accepted.logout())).status, "signed_out");
  assert.equal(await readFile(acceptedPath, "utf8"), STORED_SESSION);
  await runCauseEffect(accepted.dispose());
  cases.push("continue-accepted");

  const requestsBeforeDefault = requests.length;
  const plain = manager({ storagePath: join(root, "plain.bin") });
  const plainState = await runCauseEffect(plain.initialize());
  assert.equal(plainState.status, "signed_out");
  assert.ok(requests.slice(requestsBeforeDefault).some((url) => url === "/health/live"));
  await runCauseEffect(plain.dispose());
  cases.push("default-still-contacts-service");

  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, cases, requests, decryptCalls, error }, null, 2)}\n`,
  );
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}
