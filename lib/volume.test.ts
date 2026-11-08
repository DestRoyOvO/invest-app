import { describe, expect, it } from "vitest";

import { relativeVolume } from "./volume";

describe("relativeVolume", () => {
  it("divides today's volume by the 3-month average", () => {
    expect(relativeVolume(300, 100)).toBe(3);
    expect(relativeVolume(3e6, 1.5e6)).toBe(2);
    expect(relativeVolume(0, 100)).toBe(0);
  });

  it("is null without both numbers, with a zero average or with values that are not real volumes", () => {
    expect(relativeVolume(null, 100)).toBeNull();
    expect(relativeVolume(100, null)).toBeNull();
    expect(relativeVolume(undefined, 100)).toBeNull();
    expect(relativeVolume(100, 0)).toBeNull();
    expect(relativeVolume(-5, 100)).toBeNull();
    expect(relativeVolume(Number.NaN, 100)).toBeNull();
    expect(relativeVolume(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
