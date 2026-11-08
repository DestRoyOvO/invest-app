import { describe, expect, it } from "vitest";

import {
  DASH,
  displayedSign,
  formatChange,
  formatCompact,
  formatMultiple,
  formatNumber,
  formatPercent,
  formatPrice,
  formatRatio,
  formatRelativeTime,
  signOf,
  tpl,
} from "./format";

describe("format", () => {
  it("renders missing values as a dash", () => {
    expect(formatPrice(null)).toBe(DASH);
    expect(formatPercent(undefined)).toBe(DASH);
    expect(formatCompact(Number.NaN)).toBe(DASH);
  });

  it("formats prices with adaptive precision", () => {
    expect(formatPrice(7376.86)).toBe("7,376.86");
    expect(formatPrice(0.12345)).toBe("0.1235");
    expect(formatNumber(1234.5, 1)).toBe("1,234.5");
  });

  it("signs changes and percents", () => {
    expect(formatChange(1.8)).toBe("+1.80");
    expect(formatChange(-12.345)).toBe("-12.35");
    expect(formatChange(-0.91)).toBe("-0.91");
    expect(formatChange(0.0042)).toBe("+0.0042");
    expect(formatPercent(1.234)).toBe("+1.23%");
    expect(formatPercent(-0.5)).toBe("-0.50%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(2, { sign: false })).toBe("2.00%");
  });

  it("leaves the sign off a percent that rounds to zero", () => {
    expect(formatPercent(-0.0027)).toBe("0.00%");
    expect(formatPercent(0.004)).toBe("0.00%");
    expect(formatPercent(-0.004, { sign: false })).toBe("0.00%");
    expect(formatPercent(-0.006)).toBe("-0.01%");
    expect(formatRatio(-0.0004, { sign: true })).toBe("0.0%");
  });

  it("formats ratios and multiples", () => {
    expect(formatRatio(0.2534)).toBe("25.3%");
    expect(formatRatio(-0.05, { sign: true })).toBe("-5.0%");
    expect(formatMultiple(38.125)).toBe("38.1x");
  });

  it("formats compact numbers per language", () => {
    expect(formatCompact(4_975_383_019_520, "en")).toBe("4.98T");
    expect(formatCompact(4_975_383_019_520, "zh")).toBe("4.98万亿");
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(formatRelativeTime("2026-11-07T11:59:30Z", "en", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-07T11:00:00Z", "en", now)).toMatch(/1 hr|hour/);
    expect(formatRelativeTime("2026-11-07T11:00:00Z", "zh", now)).toMatch(/小时/);
  });

  it("computes signs and fills templates", () => {
    expect(signOf(2)).toBe(1);
    expect(signOf(-0.1)).toBe(-1);
    expect(signOf(null)).toBe(0);
    expect(tpl("{n} trades", { n: 12 })).toBe("12 trades");
  });

  it("gives the sign a number shows: zero when it rounds to zero, and for missing values", () => {
    expect(displayedSign(5)).toBe(1);
    expect(displayedSign(-5)).toBe(-1);
    expect(displayedSign(-0.004)).toBe(0);
    expect(displayedSign(-0.004, 3)).toBe(-1);
    expect(displayedSign(0.0049)).toBe(0);
    expect(displayedSign(0.006)).toBe(1);
    expect(displayedSign(null)).toBe(0);
    expect(displayedSign(Number.POSITIVE_INFINITY)).toBe(0);
    // formatPercent signs what it shows.
    for (const value of [-0.0027, -0.004, -0.006, 0, 0.004, 0.006, 1.234, -12.5]) {
      const text = formatPercent(value);
      expect(text.startsWith("+") ? 1 : text.startsWith("-") ? -1 : 0, text).toBe(displayedSign(value));
    }
  });
});
