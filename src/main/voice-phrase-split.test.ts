import { describe, expect, it } from "vitest";
import { detectedLanguage, splitAtPauses } from "./voice-phrase-split";

const RATE = 16_000;

/** Speech-like noise for `seconds`, or silence when `level` is 0. */
function tone(seconds: number, level = 0.3): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < samples.length; index += 1) samples[index] = level * Math.sin(index / 7);
  return samples;
}

function join(...parts: Float32Array[]): Float32Array {
  const total = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    total.set(part, offset);
    offset += part.length;
  }
  return total;
}

const lengths = (parts: Float32Array[]) => parts.map((part) => part.length);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("splitAtPauses", () => {
  it("cuts at each pause between phrases and keeps every sample", () => {
    const audio = join(tone(2), tone(0.5, 0), tone(1.5), tone(0.6, 0), tone(2));
    const parts = splitAtPauses(audio);
    expect(parts).toHaveLength(3);
    expect(sum(lengths(parts))).toBe(audio.length);
  });

  it("does not cut at a short gap inside a phrase", () => {
    expect(splitAtPauses(join(tone(1.5), tone(0.15, 0), tone(1.5)))).toHaveLength(1);
  });

  it("joins a phrase shorter than a second to its neighbour", () => {
    const parts = splitAtPauses(join(tone(2), tone(0.5, 0), tone(0.4), tone(0.5, 0), tone(2)));
    expect(parts).toHaveLength(2);
  });

  it("does not cut leading silence off as a phrase", () => {
    expect(splitAtPauses(join(tone(1, 0), tone(2)))).toHaveLength(1);
  });

  it("keeps silence and empty audio whole", () => {
    expect(splitAtPauses(tone(3, 0))).toHaveLength(1);
    expect(splitAtPauses(new Float32Array(0))).toHaveLength(1);
  });
});

describe("detectedLanguage", () => {
  it("reads the sherpa-onnx lang field", () => {
    expect(detectedLanguage({ text: "x", lang: "<|ar|>" })).toBe("ar");
    expect(detectedLanguage({ text: "x", lang: "en" })).toBe("en");
    expect(detectedLanguage({ text: "x" })).toBe("");
  });
});
