import { describe, expect, it } from "vitest";

import { formatBeta, formatCorrelation, formatIc, formatP, formatT, joinList, ordinal, pct, signedFixed, yearSpan } from "./stats-format";

const MINUS = "−";

describe("yearSpan", () => {
  it("joins the years of two ISO dates, or gives one year", () => {
    expect(yearSpan("2016-01-04", "2026-11-06")).toBe("2016-2026");
    expect(yearSpan("2026-01-02", "2026-11-06")).toBe("2026");
  });
});

describe("signed statistics", () => {
  it("prints ICs with three decimals, a sign and a true minus", () => {
    expect(formatIc(0.01457)).toBe("+0.015");
    expect(formatIc(-0.01006)).toBe(`${MINUS}0.010`);
    expect(formatIc(-0.0001)).toBe("0.000");
    expect(formatIc(null)).toBe("—");
    expect(signedFixed(1.5, 1)).toBe("+1.5");
  });

  it("prints t statistics without a plus sign", () => {
    expect(formatT(-1.05679)).toBe(`${MINUS}1.06`);
    expect(formatT(0.62437)).toBe("0.62");
    expect(formatT(-0.001)).toBe("0.00");
    expect(formatT(53.60816, 1)).toBe("53.6");
    expect(formatT(undefined)).toBe("—");
    expect(formatCorrelation(0.72061)).toBe("0.72");
    expect(formatBeta(-0.6123)).toBe(`${MINUS}0.61`);
    expect(formatBeta(1.8945)).toBe("1.89");
  });

  it("prints p-values at a precision that fits their size", () => {
    expect(formatP(0.0004)).toBe("<0.001");
    expect(formatP(0.004)).toBe("0.004");
    expect(formatP(0.063)).toBe("0.063");
    expect(formatP(0.42)).toBe("0.42");
    expect(formatP(1)).toBe("1.00");
    expect(formatP(null)).toBe("—");
  });
});

describe("pct", () => {
  it("formats ratios as percentages with a true minus", () => {
    expect(pct(-0.0123, 2, true)).toBe(`${MINUS}1.23%`);
    expect(pct(0.0123, 2, true)).toBe("+1.23%");
    expect(pct(0.71759, 0)).toBe("72%");
    expect(pct(-0.066)).toBe(`${MINUS}6.6%`);
  });

  it("never prints a negative zero", () => {
    expect(pct(-0.00004, 2, true)).toBe("0.00%");
    expect(pct(0, 1, true)).toBe("0.0%");
  });

  it("dashes missing values", () => {
    expect(pct(null)).toBe("—");
    expect(pct(Number.NaN)).toBe("—");
  });
});

describe("ordinal", () => {
  it("adds English ordinal suffixes, including the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 72, 101, 111].map((n) => ordinal(n, "en"))).toEqual([
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
      "72nd",
      "101st",
      "111th",
    ]);
  });

  it("rounds, and uses the plain number in Chinese", () => {
    expect(ordinal(71.6, "en")).toBe("72nd");
    expect(ordinal(71.6, "zh")).toBe("72");
  });
});

describe("joinList", () => {
  it("joins words in the reader’s language", () => {
    expect(joinList(["Low volatility", "Low beta", "Composite"], "en")).toBe("Low volatility, Low beta, and Composite");
    expect(joinList(["低波动", "低贝塔", "等权组合"], "zh")).toBe("低波动、低贝塔和等权组合");
    expect(joinList(["Low beta"], "en")).toBe("Low beta");
  });
});
