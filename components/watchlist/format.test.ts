import { describe, expect, it } from "vitest";

import { earningsBadge, formatCompactFixed, formatShares } from "./format";

describe("formatCompactFixed", () => {
  it("keeps two decimals on every compact number", () => {
    expect(formatCompactFixed(3_500_000_000_000)).toBe("3.50T");
    expect(formatCompactFixed(4_510_000_000_000)).toBe("4.51T");
    expect(formatCompactFixed(52_000_000)).toBe("52.00M");
    expect(formatCompactFixed(1_234)).toBe("1.23K");
    expect(formatCompactFixed(3_500_000_000_000, "zh")).toBe("3.50万亿");
    expect(formatCompactFixed(12_345_678, "zh")).toBe("1234.57万");
  });

  it("leaves small numbers without a suffix and handles missing values", () => {
    expect(formatCompactFixed(950)).toBe("950");
    expect(formatCompactFixed(12.5)).toBe("12.50");
    expect(formatCompactFixed(null)).toBe("—");
    expect(formatCompactFixed(Number.NaN)).toBe("—");
  });
});

describe("formatShares", () => {
  it("shows whole shares plainly and trims fractional zeros", () => {
    expect(formatShares(1200)).toBe("1,200");
    expect(formatShares(0.5)).toBe("0.5");
    expect(formatShares(2.12345)).toBe("2.1235");
  });
});

describe("earningsBadge", () => {
  const now = Date.parse("2026-11-07T15:00:00Z");

  it("shows reports up to 14 days ahead and warns within 7", () => {
    expect(earningsBadge({ nextEarningsDate: "2026-11-10T21:00:00Z", earningsDateEstimated: false }, now)).toEqual({
      days: 3,
      warn: true,
      estimated: false,
      date: "2026-11-10T21:00:00Z",
    });
    expect(earningsBadge({ nextEarningsDate: "2026-11-17T21:00:00Z", earningsDateEstimated: true }, now)).toMatchObject({ days: 10, warn: false, estimated: true });
    expect(earningsBadge({ nextEarningsDate: "2026-11-07T21:00:00Z", earningsDateEstimated: null }, now)).toMatchObject({ days: 0, warn: true });
  });

  it("hides past, distant, missing or clockless dates", () => {
    expect(earningsBadge({ nextEarningsDate: "2026-11-22T21:00:00Z", earningsDateEstimated: false }, now)).toBeNull();
    expect(earningsBadge({ nextEarningsDate: "2026-11-06T21:00:00Z", earningsDateEstimated: false }, now)).toBeNull();
    expect(earningsBadge({ nextEarningsDate: null, earningsDateEstimated: null }, now)).toBeNull();
    expect(earningsBadge(undefined, now)).toBeNull();
    expect(earningsBadge({ nextEarningsDate: "2026-11-10T21:00:00Z", earningsDateEstimated: false }, 0)).toBeNull();
  });
});
