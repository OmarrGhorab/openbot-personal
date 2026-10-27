import { describe, expect, it } from "vitest";
import {
  appBundlePath,
  FORK_RELEASES_URL,
  hasDeveloperTeam,
  needsManualInstall,
  releasePageUrl,
} from "./update-manual-install";

const ADHOC = "Executable=/Applications/OpenBot.app/Contents/MacOS/OpenBot\nSignature=adhoc\nTeamIdentifier=not set\n";
const SIGNED = "Authority=Developer ID Application: Someone (ABCDE12345)\nTeamIdentifier=ABCDE12345\n";

describe("manual update install", () => {
  it("links the fork's release page for a version", () => {
    expect(releasePageUrl("0.49.1")).toBe(`${FORK_RELEASES_URL}/tag/v0.49.1`);
    expect(releasePageUrl("v0.49.1")).toBe(`${FORK_RELEASES_URL}/tag/v0.49.1`);
    expect(FORK_RELEASES_URL).toContain("OmarrGhorab/openbot-personal");
  });

  it("reads the team from codesign output", () => {
    expect(hasDeveloperTeam(SIGNED)).toBe(true);
    expect(hasDeveloperTeam(ADHOC)).toBe(false);
    expect(hasDeveloperTeam("code object is not signed at all")).toBe(false);
  });

  it("sends only unsigned macOS builds to the release page", () => {
    expect(needsManualInstall("darwin", ADHOC)).toBe(true);
    expect(needsManualInstall("darwin", null)).toBe(true);
    expect(needsManualInstall("darwin", SIGNED)).toBe(false);
    expect(needsManualInstall("win32", null)).toBe(false);
    expect(needsManualInstall("linux", null)).toBe(false);
  });

  it("finds the app bundle of the executable", () => {
    expect(appBundlePath("/Applications/OpenBot.app/Contents/MacOS/OpenBot")).toBe("/Applications/OpenBot.app");
    expect(appBundlePath("C:\\OpenBot\\OpenBot.exe")).toBeNull();
  });
});
