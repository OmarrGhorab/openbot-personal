import { describe, expect, it } from "vitest";
import { fitsLimit, megabytes } from "./instance-transfer-preflight";

const LIMIT = 100 * 1024 * 1024;

describe("fitsLimit", () => {
  it("accepts a transfer exactly at the limit", () => {
    expect(fitsLimit(LIMIT, LIMIT)).toBe(true);
  });

  it("refuses a transfer one byte over the limit", () => {
    expect(fitsLimit(LIMIT + 1, LIMIT)).toBe(false);
  });

  it("accepts an empty transfer", () => {
    expect(fitsLimit(0, LIMIT)).toBe(true);
  });
});

describe("megabytes", () => {
  it("rounds a size up to whole megabytes for a message", () => {
    expect(megabytes(LIMIT)).toBe(100);
    expect(megabytes(LIMIT + 1)).toBe(101);
    expect(megabytes(1)).toBe(1);
  });
});
