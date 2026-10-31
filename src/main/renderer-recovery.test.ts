// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createRendererRecovery, RENDERER_AUTO_RELOADS, RENDERER_RELOAD_WINDOW_MS } from "./renderer-recovery";

// Failure mode (ticket 246): an OOM-killed renderer left a dead window that nothing reloaded.
it("reloads a crashed renderer, then asks once a crash loop passes the limit", async () => {
  let now = 0;
  const reload = vi.fn();
  const ask = vi.fn(async () => true);
  const recovery = createRendererRecovery({ now: () => now, reload, ask });
  expect(await recovery.gone("clean-exit")).toBe("ignored");
  for (let index = 0; index < RENDERER_AUTO_RELOADS; index += 1) expect(await recovery.gone("oom")).toBe("reloaded");
  expect(await recovery.gone("oom")).toBe("asked");
  expect(ask).toHaveBeenCalledWith("crashed");
  expect(reload).toHaveBeenCalledTimes(RENDERER_AUTO_RELOADS + 1);
  now += RENDERER_RELOAD_WINDOW_MS + 1;
  expect(await recovery.gone("crashed")).toBe("reloaded");
});

it("asks before reloading a hung renderer and waits when told to", async () => {
  const reload = vi.fn();
  const answers = [false, true];
  const recovery = createRendererRecovery({ now: () => 0, reload, ask: async () => answers.shift() ?? false });
  expect(await recovery.unresponsive()).toBe("waiting");
  expect(await recovery.unresponsive()).toBe("reloaded");
  expect(reload).toHaveBeenCalledTimes(1);
});
