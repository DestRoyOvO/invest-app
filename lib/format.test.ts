import { describe, expect, it } from "vitest";

import {
  changeDigits,
  DASH,
  displayedSign,
  formatChange,
  formatCompact,
  formatInteger,
  formatMultiple,
  formatNumber,
  formatPercent,
  formatPrice,
  formatRatio,
  formatRelativeTime,
  formatSigned,
  signOf,
  tpl,
} from "./format";

describe("a value that rounds to zero at the shown decimals", () => {
  it("prints as a percent without a sign, at 0, 1, 2 and 4 decimals", () => {
    expect(formatPercent(-0.004)).toBe("0.00%");
    expect(formatPercent(0.004)).toBe("0.00%");
    expect(formatPercent(-0.004, { sign: false })).toBe("0.00%");
    expect(formatPercent(-0.04, { digits: 1 })).toBe("0.0%");
    expect(formatPercent(0.04, { digits: 1 })).toBe("0.0%");
    expect(formatPercent(-0.4, { digits: 0 })).toBe("0%");
    expect(formatPercent(0.4, { digits: 0 })).toBe("0%");
    expect(formatPercent(-0.00004, { digits: 4 })).toBe("0.0000%");
    expect(formatPercent(0.00004, { digits: 4 })).toBe("0.0000%");
    expect(formatRatio(-0.00004, { sign: true })).toBe("0.0%");
  });

  it("keeps its sign once it shows at those decimals", () => {
    expect(formatPercent(-0.005)).toBe("-0.01%");
    expect(formatPercent(0.005)).toBe("+0.01%");
    expect(formatPercent(-0.05, { digits: 1 })).toBe("-0.1%");
    expect(formatPercent(-0.6, { digits: 0 })).toBe("-1%");
    expect(formatPercent(-0.00006, { digits: 4 })).toBe("-0.0001%");
    expect(formatPercent(-0.5, { sign: false })).toBe("-0.50%");
  });

  it("prints as a change without a sign: 0.00 when it rounds to zero even at four decimals", () => {
    expect(formatChange(-0.00004)).toBe("0.00");
    expect(formatChange(0.00004)).toBe("0.00");
    expect(formatChange(-0.00005)).toBe("-0.0001");
    expect(formatChange(-0.004)).toBe("-0.0040");
    expect(formatChange(-0.004999)).toBe("-0.0050");
    expect(formatChange(-0.0049, "zh")).toBe("-0.0049");
    expect(formatChange(0)).toBe("0.00");
  });

  it("prints with fixed decimals without a sign (formatSigned)", () => {
    expect(formatSigned(-0.004, 2)).toBe("0.00");
    expect(formatSigned(0.004, 2)).toBe("0.00");
    expect(formatSigned(-0.04, 1)).toBe("0.0");
    expect(formatSigned(-0.4, 0)).toBe("0");
    expect(formatSigned(-0.6, 0)).toBe("-1");
    expect(formatSigned(-0.00004, 4)).toBe("0.0000");
    expect(formatSigned(-0.00006, 4)).toBe("-0.0001");
    expect(formatSigned(0.0005, 3)).toBe("+0.001");
    expect(formatSigned(1234.5, 2, "zh")).toBe("+1,234.50");
    expect(formatSigned(null, 2)).toBe(DASH);
  });

  it("prints unsigned numbers and integers without Intl's minus sign", () => {
    expect(formatNumber(-0.001)).toBe("0.00");
    expect(formatNumber(-0.005)).toBe("-0.01");
    expect(formatNumber(-0.00004, 4)).toBe("0.0000");
    expect(formatInteger(-0.4)).toBe("0");
    expect(formatInteger(-0.6)).toBe("-1");
  });

  it("treats −0 itself as zero", () => {
    expect(formatPercent(-0)).toBe("0.00%");
    expect(formatPercent(-0, { digits: 0 })).toBe("0%");
    expect(formatChange(-0)).toBe("0.00");
    expect(formatSigned(-0, 4)).toBe("0.0000");
    expect(formatNumber(-0)).toBe("0.00");
    expect(formatInteger(-0)).toBe("0");
    expect(displayedSign(-0, 2)).toBe(0);
  });
});

describe("displayedSign", () => {
  it("is the sign of the value as printed with the given decimals", () => {
    expect(displayedSign(5, 2)).toBe(1);
    expect(displayedSign(-5, 2)).toBe(-1);
    expect(displayedSign(-0.004, 2)).toBe(0);
    expect(displayedSign(0.004, 2)).toBe(0);
    expect(displayedSign(-0.004, 3)).toBe(-1);
    expect(displayedSign(0.005, 2)).toBe(1);
    expect(displayedSign(-0.04, 1)).toBe(0);
    expect(displayedSign(-0.05, 1)).toBe(-1);
    expect(displayedSign(-0.4, 0)).toBe(0);
    expect(displayedSign(-0.5, 0)).toBe(-1);
    expect(displayedSign(-0.00004, 4)).toBe(0);
    expect(displayedSign(-0.00005, 4)).toBe(-1);
  });

  it("is zero for missing and non-finite values", () => {
    expect(displayedSign(null, 2)).toBe(0);
    expect(displayedSign(undefined, 2)).toBe(0);
    expect(displayedSign(Number.NaN, 2)).toBe(0);
    expect(displayedSign(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });

  it("agrees with the sign every formatter prints", () => {
    const values = [-1.2345, -0.0051, -0.005, -0.0049, -0.00005, -0.00004, -0, 0, 0.00004, 0.00005, 0.0049, 0.005, 0.0051, 1.2345];
    const signOfText = (text: string) => (text.startsWith("+") ? 1 : text.startsWith("-") ? -1 : 0);
    for (const value of values) {
      for (const digits of [0, 1, 2, 3, 4]) {
        expect(signOfText(formatPercent(value, { digits })), `${value} at ${digits}`).toBe(displayedSign(value, digits));
        expect(signOfText(formatSigned(value, digits)), `${value} at ${digits}`).toBe(displayedSign(value, digits));
      }
      expect(signOfText(formatChange(value))).toBe(displayedSign(value, changeDigits(value)));
    }
  });
});

describe("changeDigits", () => {
  it("gives a sub-cent move four decimals, unless it rounds to zero even there", () => {
    expect(changeDigits(0.0042)).toBe(4);
    expect(changeDigits(-0.0042)).toBe(4);
    expect(changeDigits(-0.00005)).toBe(4);
    expect(changeDigits(-0.00004)).toBe(2);
    expect(changeDigits(0)).toBe(2);
    expect(changeDigits(0.01)).toBe(2);
    expect(changeDigits(-12.5)).toBe(2);
    expect(changeDigits(null)).toBe(2);
  });
});

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
});
