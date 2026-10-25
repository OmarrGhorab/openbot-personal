// Checks the onboarding screen order. It does not start the desktop app.
//
// Run: bun scripts/onboarding-step-order-e2e.ts
// It writes .openbot-build/onboarding-step-order-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { onboardingScreen } from "../src/renderer/src/features/onboarding/access-gate-screen";
import { firstRunSteps } from "../src/renderer/src/features/onboarding/first-run-steps";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "onboarding-step-order-e2e");

const fresh = {
  signedIn: false,
  authStatus: "signed_out",
  languageDone: false,
  setupCompleted: false,
  hasServerContent: true,
  setupReadFailed: false,
  hasPendingInvite: false,
};

const steps = [
  onboardingScreen(fresh),
  onboardingScreen({ ...fresh, languageDone: true }),
  onboardingScreen({ ...fresh, signedIn: true, authStatus: "signed_in", languageDone: true }),
];
const freeDarwin = firstRunSteps("free", "darwin");
const planDarwin = firstRunSteps("plan", "darwin");
const freeWindows = firstRunSteps("free", "win32");
const planLinux = firstRunSteps("plan", "linux");

const appView = readFileSync(join(ROOT, "src/renderer/src/AppView.tsx"), "utf8");
const firstRun = readFileSync(join(ROOT, "src/renderer/src/features/onboarding/FirstRunFlow.tsx"), "utf8");
const mainIndex = readFileSync(join(ROOT, "src/main/index.ts"), "utf8");

let error: string | undefined;
try {
  assert.deepEqual(steps, ["language", "sign-in", "first-run"]);
  assert.equal(
    onboardingScreen({ ...fresh, signedIn: true, authStatus: "signed_in", languageDone: false }),
    "first-run",
  );
  assert.equal(
    onboardingScreen({ ...fresh, signedIn: true, authStatus: "signed_in", languageDone: true, hasPendingInvite: true }),
    "invite-setup",
  );
  assert.equal(
    onboardingScreen({ ...fresh, signedIn: true, authStatus: "signed_in", languageDone: true, setupCompleted: true }),
    "workspace",
  );
  assert.deepEqual(freeDarwin, ["choose", "computer"]);
  assert.deepEqual(planDarwin, ["choose", "plan", "computer"]);
  assert.deepEqual(freeWindows, ["choose"]);
  assert.deepEqual(planLinux, ["choose", "plan"]);
  assert.deepEqual(firstRunSteps(null, "darwin"), ["choose", "computer"]);
  assert.match(appView, /showLanguageStep\(/);
  assert.match(appView, /<LanguageStep/);
  assert.match(appView, /<AccountLogin/);
  assert.match(appView, /<FirstRunFlow/);
  assert.equal(appView.includes("OPENBOT_DEV_SKIP_ACCOUNT"), false);
  assert.equal(appView.includes("onContinueWithoutAccount"), false);
  assert.match(firstRun, /firstRunSteps\(path, props\.platform\)/);
  assert.equal(mainIndex.includes("OPENBOT_DEV_SKIP_ACCOUNT"), false);
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
}

const report = {
  passed: error === undefined,
  steps,
  firstRun: { freeDarwin, planDarwin, freeWindows, planLinux },
  skipAccountFlag: "absent",
  ...(error ? { error } : {}),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${report.passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
);
if (!report.passed) process.exitCode = 1;
