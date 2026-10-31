// @vitest-environment node
import { expect, it } from "vitest";
import { releaseStopAllForMessage } from "./stop-all-release";

it("lifts Stop all when the person sends a message, and does nothing otherwise", async () => {
  let stopped = true;
  let resumes = 0;
  const state = {
    stoppedAll: async () => stopped,
    resumeAll: async () => {
      resumes += 1;
      stopped = false;
    },
  };
  expect(await releaseStopAllForMessage(state)).toBe(true);
  expect(stopped).toBe(false);
  expect(await releaseStopAllForMessage(state)).toBe(false);
  expect(resumes).toBe(1);
});
