import { execFile } from "node:child_process";

/** The releases of this fork. electron-builder's `publish` block in electron-builder.yml names the same repository. */
export const FORK_RELEASES_URL = "https://github.com/OmarrGhorab/openbot-personal/releases";

/** The release page of one version. The release workflow tags every release `v<version>`. */
export function releasePageUrl(version: string): string {
  return `${FORK_RELEASES_URL}/tag/v${encodeURIComponent(version.replace(/^v/, ""))}`;
}

/**
 * Whether `codesign -dv` output names a Developer ID team. Squirrel.Mac only installs an update
 * signed by the same team, so an ad-hoc or unsigned build ("TeamIdentifier=not set", or no
 * signature at all) cannot install its own update.
 */
export function hasDeveloperTeam(codesignOutput: string): boolean {
  const team = /^TeamIdentifier=(.+)$/m.exec(codesignOutput)?.[1]?.trim();
  return Boolean(team) && team !== "not set";
}

/** Whether this build has to send the user to the release page instead of installing an update. */
export function needsManualInstall(platform: NodeJS.Platform, codesignOutput: string | null): boolean {
  if (platform !== "darwin") return false;
  return codesignOutput === null || !hasDeveloperTeam(codesignOutput);
}

/** The `.app` bundle that contains the executable, or null outside one. */
export function appBundlePath(executablePath: string): string | null {
  const match = /^(.*?\.app)\/Contents\/MacOS\//.exec(executablePath);
  return match?.[1] ?? null;
}

/** Reads the signature of the running app bundle. A failure counts as unsigned. */
export function readCodeSignature(bundlePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/codesign", ["-dv", "--verbose=2", bundlePath], { timeout: 10_000 }, (error, stdout, stderr) => {
      // codesign prints the details on stderr, and exits non-zero for an unsigned bundle.
      if (error && !stderr) resolve(null);
      else resolve(`${stdout}\n${stderr}`);
    });
  });
}
