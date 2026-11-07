import { describe, expect, it } from "vitest";

import { earningsMessages } from "@/lib/i18n/earnings";
import type { EarningsDetail, EarningsEstimate, EarningsQuarter, ImpliedMove } from "@/types/earnings";

import {
  daysUntil,
  estimateTrend,
  formatTarget,
  intoReportNote,
  isNonEquity,
  lastSurprises,
  periodMonth,
  ratingSegments,
  ratingTotal,
  relativeChange,
  scalePosition,
  shortDay,
  signedPercent,
  surpriseMark,
  targetScale,
  upcomingQuarter,
  weekdayDay,
  withinDays,
} from "./earnings-model";

const NOW = Date.parse("2026-11-07T15:00:00Z");

const quarter = (period: string, end: string, actual: number, estimate: number): EarningsQuarter => ({
  period,
  fiscalPeriod: null,
  periodEnd: `${end}T00:00:00.000Z`,
  reportedAt: null,
  epsActual: actual,
  epsEstimate: estimate,
  surprise: (actual - estimate) / Math.abs(estimate),
});

const estimate = (period: EarningsEstimate["period"], end: string, avg: number, overrides: Partial<EarningsEstimate> = {}): EarningsEstimate => ({
  period,
  periodEnd: `${end}T00:00:00.000Z`,
  epsAvg: avg,
  epsLow: avg * 0.95,
  epsHigh: avg * 1.1,
  yearAgoEps: null,
  revenueAvg: null,
  revenueLow: null,
  revenueHigh: null,
  analysts: 40,
  epsTrend: { current: avg, d7: avg, d30: avg, d60: avg, d90: avg },
  revisions: { up7: 0, up30: 0, down7: 0, down30: 0 },
  ...overrides,
});

const NVDA: EarningsDetail = {
  symbol: "NVDA",
  asOf: "2026-11-07T15:00:00.000Z",
  financialCurrency: "USD",
  epsCurrency: "USD",
  nextDate: "2026-11-17T21:00:00.000Z",
  nextDateEstimated: false,
  nextTiming: "post",
  consensus: {
    epsAvg: 2.47325,
    epsLow: 2.34,
    epsHigh: 2.7,
    revenueAvg: 108976833310,
    revenueLow: 104937000000,
    revenueHigh: 116251000000,
    analysts: 44,
    revenueAnalysts: 45,
    periodEnd: "2026-10-31T00:00:00.000Z",
    source: "calendar",
  },
  history: [
    quarter("3Q2025", "2025-10-31", 1.3, 1.25647),
    quarter("4Q2025", "2026-01-31", 1.62, 1.53812),
    quarter("1Q2026", "2026-04-30", 1.87, 1.77191),
    quarter("2Q2026", "2026-07-31", 2.22, 2.09113),
  ],
  estimates: [
    estimate("0q", "2026-10-31", 2.47325, {
      epsTrend: { current: 2.47325, d7: 2.47325, d30: 2.47356, d60: 2.46864, d90: 2.34245 },
      revisions: { up7: 0, up30: 0, down7: 1, down30: 1 },
    }),
    estimate("+1q", "2027-01-31", 2.74622),
  ],
};

const IMPLIED: ImpliedMove = {
  symbol: "NVDA",
  asOf: "2026-11-07T15:00:00.000Z",
  report: { at: "2026-11-17T21:00:00.000Z", estimated: false, timing: "post" },
  expiry: "2026-11-20T00:00:00.000Z",
  daysToExpiry: 13,
  strike: 187.5,
  price: 186.64,
  callPrice: 10.2,
  putPrice: 10.8,
  straddle: 21,
  move: 21 / 186.64,
  basis: "mid",
  currency: "USD",
};

describe("surprises", () => {
  it("marks beats, misses and in-line quarters with a half-percent band", () => {
    expect(surpriseMark(0.0578)).toBe("beat");
    expect(surpriseMark(-0.039)).toBe("miss");
    expect(surpriseMark(0.0019)).toBe("inline");
    expect(surpriseMark(null)).toBeNull();
    expect(surpriseMark(Number.NaN)).toBeNull();
  });

  it("keeps the last four quarters with a surprise, oldest first", () => {
    const history = [quarter("1Q", "2025-03-31", 1, 1.1), ...NVDA.history, { ...quarter("X", "2026-10-31", 1, 1), surprise: null }];
    expect(lastSurprises(history).map((s) => [s.period, s.mark])).toEqual([
      ["3Q2025", "beat"],
      ["4Q2025", "beat"],
      ["1Q2026", "beat"],
      ["2Q2026", "beat"],
    ]);
    expect(lastSurprises([quarter("1Q", "2025-03-31", 1, 1.1)])[0].mark).toBe("miss");
  });
});

describe("estimates", () => {
  it("finds the quarter behind the next report and the change of its estimate", () => {
    expect(upcomingQuarter(NVDA)?.period).toBe("0q");
    expect(upcomingQuarter({ ...NVDA, consensus: null })?.period).toBe("0q");
    const trend = estimateTrend(upcomingQuarter(NVDA)!);
    expect(trend.map((p) => p.key)).toEqual(["now", "d7", "d30", "d90"]);
    expect(trend[0].changeToNow).toBeNull();
    expect(trend[3].changeToNow).toBeCloseTo(2.47325 / 2.34245 - 1, 10);
    expect(relativeChange(-0.5, -1)).toBeCloseTo(0.5, 10);
    expect(relativeChange(1, 0)).toBeNull();
    expect(signedPercent(0.0558)).toBe("+5.6%");
    expect(signedPercent(-0.021)).toBe("−2.1%");
    expect(signedPercent(null)).toBe("—");
  });
});

describe("dates", () => {
  it("counts New York days to a report", () => {
    expect(daysUntil(NVDA.nextDate, NOW)).toBe(10);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(withinDays(NVDA.nextDate, NOW, 14)).toBe(true);
    expect(withinDays(NVDA.nextDate, NOW, 7)).toBe(false);
    expect(withinDays("2026-11-06T21:00:00.000Z", NOW, 14)).toBe(false);
    expect(shortDay("2026-11-20T00:00:00.000Z", "en")).toBe("Nov 20");
    expect(weekdayDay("2026-11-17T21:00:00.000Z", "en")).toBe("Tue, Nov 17");
    expect(weekdayDay("2026-11-17T21:00:00.000Z", "zh")).toBe("11月17日周二");
  });
});

describe("intoReportNote", () => {
  it("states when, the consensus, the estimate trend, the beat record and the implied move", () => {
    expect(intoReportNote(NVDA, IMPLIED, NOW, earningsMessages.en, "en")).toEqual([
      "Reports in 10 days (Tue, Nov 17), after close.",
      "Consensus EPS is 2.47 from 44 analysts, with estimates from 2.34 to 2.70.",
      "Revenue consensus is 108.98B.",
      "The EPS estimate rose 5.6% over 90 days.",
      "Revisions in the last 30 days: 0 up, 1 down.",
      "Reported EPS beat the estimate in 4 of the last 4 quarters.",
      "Options imply about ±11.3% by the Nov 20 expiry.",
    ]);
  });

  it("says when the date is not confirmed and skips what is missing", () => {
    const tbd: EarningsDetail = { ...NVDA, nextDate: "2026-11-08T21:00:00.000Z", nextDateEstimated: true, nextTiming: null, consensus: null, estimates: [], history: [] };
    expect(intoReportNote(tbd, null, NOW, earningsMessages.en, "en")).toEqual(["Expected tomorrow (Sun, Nov 8); the company has not confirmed the date or time."]);
    expect(intoReportNote({ ...NVDA, nextDate: null }, null, NOW, earningsMessages.en, "en")).toEqual([]);
  });

  it("writes Chinese sentences without English case changes", () => {
    const note = intoReportNote(NVDA, null, NOW, earningsMessages.zh, "zh");
    expect(note[0]).toBe("10 天后（11月17日周二）盘后发布财报。");
    expect(note.at(-1)).toBe("最近 4 个季度中有 4 个季度的每股收益高于预期。");
  });
});

describe("analyst helpers", () => {
  const month = { period: "0m", strongBuy: 6, buy: 18, hold: 14, sell: 3, strongSell: 3 };

  it("totals ratings and splits them into shares", () => {
    expect(ratingTotal(month)).toBe(44);
    const segments = ratingSegments(month);
    expect(segments.map((s) => s.key)).toEqual(["strongBuy", "buy", "hold", "sell", "strongSell"]);
    expect(segments[1].share).toBeCloseTo(18 / 44, 10);
    expect(ratingSegments({ ...month, strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 }).every((s) => s.share === 0)).toBe(true);
  });

  it("names the month of each period", () => {
    expect(periodMonth("0m", NOW, "en")).toBe("Nov");
    expect(periodMonth("-3m", NOW, "en")).toBe("Aug");
    expect(periodMonth("-1m", Date.parse("2026-01-10T15:00:00Z"), "en")).toBe("Dec");
    expect(periodMonth("-2m", NOW, "zh")).toBe("9月");
  });

  it("builds a target scale that holds the price", () => {
    const scale = targetScale(180, 515, 186.64)!;
    expect(scale.min).toBeLessThan(180);
    expect(scale.max).toBeGreaterThan(515);
    const below = targetScale(250, 405, 200)!;
    expect(scalePosition(below, 200)).toBeGreaterThan(0);
    expect(scalePosition(below, 200)).toBeLessThan(scalePosition(below, 250));
    expect(scalePosition(below, 1e9)).toBe(100);
    expect(targetScale(null, 405, 200)).toBeNull();
    expect(targetScale(300, 300, 200)).toBeNull();
    expect(formatTarget(1234.5, "en")).toBe("1,235");
    expect(formatTarget(327.1431, "en")).toBe("327.14");
    expect(formatTarget(null, "en")).toBe("—");
  });
});

describe("isNonEquity", () => {
  it("skips funds, indices and crypto once the quote type is known", () => {
    expect(isNonEquity("ETF")).toBe(true);
    expect(isNonEquity("INDEX")).toBe(true);
    expect(isNonEquity("EQUITY")).toBe(false);
    expect(isNonEquity(null)).toBe(false);
    expect(isNonEquity(undefined)).toBe(false);
  });
});
