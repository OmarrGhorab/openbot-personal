import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GlobalVoiceTimeout,
  MAIN_TRANSCRIPTION_TIMEOUT_MS,
  TRANSCRIBE_TIMEOUT_MS,
  withTimeout,
} from "./global-voice-picker-logic";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes on a result that arrives in time and clears its timer", async () => {
    const result = withTimeout(Promise.resolve("sent"), 1_000);
    await expect(result).resolves.toBe("sent");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes on a failure that arrives in time", async () => {
    const failure = new Error("refused");
    await expect(withTimeout(Promise.reject(failure), 1_000)).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with a timeout when the work never settles", async () => {
    const settled = withTimeout(new Promise<never>(() => {}), 20_000);
    const outcome = settled.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBeInstanceOf(GlobalVoiceTimeout);
  });

  it("does not turn a late result into an unhandled rejection", async () => {
    let finish: (value: string) => void = () => {};
    const late = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const settled = withTimeout(late, 5_000).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(settled).resolves.toBeInstanceOf(GlobalVoiceTimeout);
    finish("too late");
    await expect(late).resolves.toBe("too late");
  });
});

describe("transcription timeout", () => {
  it("matches main's limit and waits a little longer, so main's error is shown first", () => {
    const service = readFileSync(new URL("../../../../main/voice-transcription-service.ts", import.meta.url), "utf8");
    const match = /const TRANSCRIPTION_TIMEOUT_MS = ([\d_]+);/.exec(service);
    expect(match).not.toBeNull();
    expect(Number(match?.[1]?.replaceAll("_", ""))).toBe(MAIN_TRANSCRIPTION_TIMEOUT_MS);
    expect(TRANSCRIBE_TIMEOUT_MS).toBeGreaterThan(MAIN_TRANSCRIPTION_TIMEOUT_MS);
  });
});
