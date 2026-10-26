import { describe, expect, it } from "vitest";
import { openWhileWarming } from "./voice-warm-start";

describe("openWhileWarming", () => {
  it("opens the microphone without waiting for the model to load", async () => {
    const order: string[] = [];
    let finishWarm = (): void => {};
    const warm = (): Promise<void> => {
      order.push("warm started");
      return new Promise((resolve) => {
        finishWarm = () => {
          order.push("warm finished");
          resolve();
        };
      });
    };
    const stream = await openWhileWarming(warm, async () => {
      order.push("microphone opened");
      return "stream";
    });
    expect(stream).toBe("stream");
    expect(order).toEqual(["warm started", "microphone opened"]);
    finishWarm();
    await Promise.resolve();
    expect(order).toEqual(["warm started", "microphone opened", "warm finished"]);
  });

  it("still opens the microphone when the model load fails", async () => {
    const stream = await openWhileWarming(
      () => Promise.reject(new Error("load failed")),
      async () => "stream",
    );
    expect(stream).toBe("stream");
  });

  it("passes on a microphone failure", async () => {
    await expect(
      openWhileWarming(
        async () => undefined,
        () => Promise.reject(new Error("denied")),
      ),
    ).rejects.toThrow("denied");
  });
});
