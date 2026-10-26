import { describe, expect, it } from "vitest";
import { finalTextWithRetries, PcmBuffer, SkipWhileBusy } from "./global-voice-stream-audio";

describe("PcmBuffer", () => {
  it("hands out only the samples after what was already sent", () => {
    const buffer = new PcmBuffer();
    buffer.append(Float32Array.of(1, 2, 3));
    buffer.append(Float32Array.of(4, 5));
    expect(buffer.length).toBe(5);
    expect([...buffer.from(0)]).toEqual([1, 2, 3, 4, 5]);
    expect([...buffer.from(2)]).toEqual([3, 4, 5]);
    expect([...buffer.from(3)]).toEqual([4, 5]);
    expect(buffer.from(5).length).toBe(0);
    expect(buffer.from(9).length).toBe(0);
  });

  it("keeps a copy, because the audio graph reuses its buffer", () => {
    const buffer = new PcmBuffer();
    const reused = Float32Array.of(1, 2);
    buffer.append(reused);
    reused[0] = 9;
    expect([...buffer.from(0)]).toEqual([1, 2]);
    buffer.clear();
    expect(buffer.length).toBe(0);
  });
});

describe("SkipWhileBusy", () => {
  it("skips a live pass while one is running, then runs the next", async () => {
    const gate = new SkipWhileBusy();
    let runs = 0;
    let finish = (): void => {};
    const pass = (): Promise<void> => {
      runs += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    gate.run(pass);
    gate.run(pass);
    gate.run(pass);
    expect(runs).toBe(1);
    expect(gate.busy).toBe(true);
    finish();
    await gate.idle();
    expect(gate.busy).toBe(false);
    gate.run(pass);
    expect(runs).toBe(2);
    finish();
    await gate.idle();
  });

  it("frees itself after a failed pass", async () => {
    const gate = new SkipWhileBusy();
    gate.run(() => Promise.reject(new Error("host ended")));
    await gate.idle();
    expect(gate.busy).toBe(false);
  });
});

describe("finalTextWithRetries", () => {
  it("returns the first final text", async () => {
    let calls = 0;
    const text = await finalTextWithRetries(
      3,
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("dropped");
        return "hello there";
      },
      () => new Error("failed"),
    );
    expect(text).toBe("hello there");
    expect(calls).toBe(2);
  });

  it("throws when every attempt fails, instead of sending partial text as final", async () => {
    let calls = 0;
    await expect(
      finalTextWithRetries(
        3,
        async () => {
          calls += 1;
          throw new Error("dropped");
        },
        () => new Error("failed"),
      ),
    ).rejects.toThrow("dropped");
    expect(calls).toBe(3);
  });

  it("throws its own error when no stream could open", async () => {
    await expect(
      finalTextWithRetries(
        2,
        async () => undefined,
        () => new Error("failed"),
      ),
    ).rejects.toThrow("failed");
  });
});
