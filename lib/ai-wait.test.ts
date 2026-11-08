import { describe, expect, it } from "vitest";

import { aiWait, isDailyLimit } from "./ai-wait";

describe("aiWait", () => {
  it("keeps short waits in whole seconds, rounded up", () => {
    expect(aiWait(1)).toEqual({ unit: "s", value: 1 });
    expect(aiWait(42.2)).toEqual({ unit: "s", value: 43 });
    expect(aiWait(119)).toEqual({ unit: "s", value: 119 });
  });

  it("switches to minutes from two minutes and to hours from two hours", () => {
    expect(aiWait(120)).toEqual({ unit: "min", value: 2 });
    expect(aiWait(121)).toEqual({ unit: "min", value: 3 });
    expect(aiWait(7_140)).toEqual({ unit: "min", value: 119 });
    expect(aiWait(7_141)).toEqual({ unit: "h", value: 2 });
    expect(aiWait(7_200)).toEqual({ unit: "h", value: 2 });
    expect(aiWait(50_000)).toEqual({ unit: "h", value: 14 });
  });

  it("falls back to a minute without a usable Retry-After", () => {
    for (const value of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(aiWait(value)).toEqual({ unit: "s", value: 60 });
  });

  it("recognizes the daily budget message", () => {
    expect(isDailyLimit("The daily AI limit for this server has been reached.")).toBe(true);
    expect(isDailyLimit("Too many AI requests. Please wait a moment and retry.")).toBe(false);
    expect(isDailyLimit(undefined)).toBe(false);
  });
});
