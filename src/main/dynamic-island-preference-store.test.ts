import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  defaultDynamicIslandPreference,
  readDynamicIslandPreference,
  writeDynamicIslandPreference,
} from "./dynamic-island-preference-store";

const file = () => join(mkdtempSync(join(tmpdir(), "island-pref-")), "dynamic-island.json");

describe("dynamic island preference off macOS", () => {
  it("stays on by default on macOS, as before", async () => {
    expect((await Effect.runPromise(readDynamicIslandPreference(file(), "darwin"))).enabled).toBe(true);
    expect(defaultDynamicIslandPreference("darwin").enabled).toBe(true);
  });

  it("stays off by default on Windows and Linux", async () => {
    for (const platform of ["win32", "linux"] as const) {
      expect((await Effect.runPromise(readDynamicIslandPreference(file(), platform))).enabled).toBe(false);
      expect(defaultDynamicIslandPreference(platform).enabled).toBe(false);
    }
  });

  it("ignores an enabled file without the opt-in on Windows", async () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ version: 1, enabled: true }));
    expect((await Effect.runPromise(readDynamicIslandPreference(path, "win32"))).enabled).toBe(false);
    expect((await Effect.runPromise(readDynamicIslandPreference(path, "darwin"))).enabled).toBe(true);
  });

  it("turns on after the user opts in on Windows, and off again", async () => {
    const path = file();
    const on = { ...defaultDynamicIslandPreference("win32"), enabled: true };
    await Effect.runPromise(writeDynamicIslandPreference(path, on, "win32"));
    expect(JSON.parse(readFileSync(path, "utf8")).offMacOptIn).toBe(true);
    expect((await Effect.runPromise(readDynamicIslandPreference(path, "win32"))).enabled).toBe(true);
    await Effect.runPromise(writeDynamicIslandPreference(path, { ...on, enabled: false }, "win32"));
    expect((await Effect.runPromise(readDynamicIslandPreference(path, "win32"))).enabled).toBe(false);
  });
});
