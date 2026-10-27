import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { type UpdateAdapter, UpdateService } from "./update-service";

function fakeAdapter(version: string) {
  const downloadUpdate = vi.fn(async () => []);
  const adapter: UpdateAdapter = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    checkForUpdates: async () => ({
      isUpdateAvailable: true,
      updateInfo: { version },
      cancellationToken: { cancel: () => undefined, cancelled: false },
    }),
    downloadUpdate,
    on: () => undefined,
    quitAndInstall: () => undefined,
  };
  return { adapter, downloadUpdate };
}

describe("UpdateService manual install", () => {
  it("reports the update and opens the release page instead of downloading", async () => {
    const { adapter, downloadUpdate } = fakeAdapter("9.9.9");
    const opened: string[] = [];
    const service = new UpdateService(adapter, {
      currentVersion: "0.49.0",
      enabled: true,
      autoDownload: true,
      beforeInstall: async () => undefined,
      platform: "darwin",
      manualInstall: { openReleasePage: (version) => void opened.push(version) },
    });
    const checked = await Effect.runPromise(service.checkForUpdates());
    expect(checked.phase).toBe("available");
    expect(checked.availableVersion).toBe("9.9.9");
    expect(checked.manualInstall).toBe(true);
    const after = await Effect.runPromise(service.downloadUpdate());
    expect(after.phase).toBe("available");
    expect(opened).toEqual(["9.9.9"]);
    await Effect.runPromise(service.setAutoDownload(true));
    expect(service.getAutoDownload()).toBe(false);
    expect(downloadUpdate).not.toHaveBeenCalled();
    await Effect.runPromise(service.stop());
  });

  it("downloads normally without manual install", async () => {
    const { adapter, downloadUpdate } = fakeAdapter("9.9.9");
    const service = new UpdateService(adapter, {
      currentVersion: "0.49.0",
      enabled: true,
      autoDownload: false,
      beforeInstall: async () => undefined,
      platform: "win32",
    });
    const checked = await Effect.runPromise(service.checkForUpdates());
    expect(checked.manualInstall).toBeUndefined();
    await Effect.runPromise(service.downloadUpdate());
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
    await Effect.runPromise(service.stop());
  });
});
