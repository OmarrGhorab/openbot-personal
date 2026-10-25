/**
 * The screen `AppAccessGate` shows after the splash. The language wheel is before email sign-in.
 * A signed-in session does not show the wheel. First run follows a successful sign-in when setup
 * is still open and this computer has its server connection.
 */
export type OnboardingScreen = "language" | "sign-in" | "first-run" | "invite-setup" | "setup-error" | "workspace";

export function showLanguageStep(input: { authStatus: string; languageDone: boolean }): boolean {
  return input.authStatus === "signed_out" && !input.languageDone;
}

export function onboardingScreen(input: {
  signedIn: boolean;
  authStatus: string;
  languageDone: boolean;
  setupCompleted: boolean;
  hasServerContent: boolean;
  setupReadFailed: boolean;
  hasPendingInvite: boolean;
}): OnboardingScreen {
  if (!input.signedIn) return showLanguageStep(input) ? "language" : "sign-in";
  if (input.setupCompleted || !input.hasServerContent) return "workspace";
  if (input.setupReadFailed) return "setup-error";
  if (input.hasPendingInvite) return "invite-setup";
  return "first-run";
}
