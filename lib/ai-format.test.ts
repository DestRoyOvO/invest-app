import { describe, expect, it } from "vitest";

import { clip, daysUntil, fmtDaysUntil, fmtPoints, fmtShare, fmtSigned, ordinal, untrusted, UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from "./ai-format";

describe("ai-format helpers", () => {
  it("formats signed amounts and point differences", () => {
    expect(fmtSigned(412.3)).toBe("+412.30");
    expect(fmtSigned(-80)).toBe("-80.00");
    expect(fmtSigned(0)).toBe("+0.00");
    expect(fmtSigned(null)).toBe("n/a");
    expect(fmtPoints(1.333)).toBe("+1.33 pt");
    expect(fmtPoints(-0.5)).toBe("-0.50 pt");
    expect(fmtShare(0.314)).toBe("31%");
  });

  it("clips at a sentence or word boundary", () => {
    expect(clip("Short text.", 50)).toBe("Short text.");
    const text = "First sentence is here. Second sentence goes on and on without stopping anywhere soon";
    expect(clip(text, 40)).toBe("First sentence is here.…");
    expect(clip("word ".repeat(30), 41).endsWith("…")).toBe(true);
    expect(clip("word ".repeat(30), 41).length).toBeLessThanOrEqual(41);
  });

  it("counts calendar days to a date", () => {
    const now = new Date("2026-11-07T22:30:00Z");
    expect(daysUntil("2026-11-19", now)).toBe(12);
    expect(daysUntil("2026-11-19T21:00:00.000Z", now)).toBe(12);
    expect(daysUntil("2026-11-07", now)).toBe(0);
    expect(daysUntil("2026-11-05", now)).toBe(-2);
    expect(daysUntil("not a date", now)).toBeNull();
    expect(fmtDaysUntil(0)).toBe("today");
    expect(fmtDaysUntil(1)).toBe("tomorrow");
    expect(fmtDaysUntil(-1)).toBe("yesterday");
    expect(fmtDaysUntil(12)).toBe("in 12 days");
    expect(fmtDaysUntil(-3)).toBe("3 days ago");
  });

  it("fences third-party text exactly once", () => {
    const wrapped = untrusted(`a ${UNTRUSTED_CLOSE} b`);
    expect(wrapped.split(UNTRUSTED_OPEN)).toHaveLength(2);
    expect(wrapped.split(UNTRUSTED_CLOSE)).toHaveLength(2);
  });
});

describe("ordinal", () => {
  it("adds English ordinal suffixes", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 73, 100, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "73rd",
      "100th",
      "101st",
      "111th",
    ]);
    expect(ordinal(72.6)).toBe("73rd");
  });
});
