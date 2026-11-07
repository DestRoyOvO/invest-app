import { describe, expect, it } from "vitest";

import type { DailyBar } from "@/lib/bars";
import type { AnalystActivity, EarningsDetail, EarningsEstimate } from "@/types/earnings";

import {
  actionText,
  analystBlock,
  earningsBlock,
  isIntoReport,
  lastReported,
  recentActions,
  reportReactions,
  reportTiming,
  upcomingConsensus,
  upcomingEstimate,
} from "./ai-earnings";

const NOW = new Date("2026-11-07T16:00:00Z");

function estimate(period: EarningsEstimate["period"], epsAvg: number, overrides: Partial<EarningsEstimate> = {}): EarningsEstimate {
  return {
    period,
    periodEnd: null,
    epsAvg,
    epsLow: epsAvg - 0.1,
    epsHigh: epsAvg + 0.2,
    yearAgoEps: null,
    revenueAvg: 100e9,
    revenueLow: 95e9,
    revenueHigh: 110e9,
    analysts: 40,
    epsTrend: { current: epsAvg, d7: epsAvg, d30: 2.4, d60: 2.35, d90: 2.3 },
    revisions: { up7: 3, up30: 12, down7: 0, down30: 2 },
    ...overrides,
  };
}

const DETAIL: EarningsDetail = {
  symbol: "NVDA",
  asOf: "2026-11-07T15:00:00.000Z",
  financialCurrency: "USD",
  nextDate: "2026-11-19T21:00:00.000Z",
  nextDateEstimated: false,
  consensus: { epsAvg: 2.47, epsLow: 2.34, epsHigh: 2.7, revenueAvg: 108.98e9, revenueLow: 104.94e9, revenueHigh: 116.25e9 },
  history: [
    { period: "3Q2025", periodEnd: "2025-10-26", reportedAt: "2025-11-19T21:20:00.000Z", epsActual: 1.3, epsEstimate: 1.25, surprise: 0.04 },
    { period: "4Q2025", periodEnd: "2026-01-25", reportedAt: "2026-02-25T21:20:00.000Z", epsActual: 1.62, epsEstimate: 1.53, surprise: 0.0588 },
    { period: "1Q2026", periodEnd: "2026-04-26", reportedAt: "2026-05-27T00:00:00.000Z", epsActual: 1.83, epsEstimate: 1.76, surprise: 0.0398 },
    { period: "2Q2026", periodEnd: "2026-07-26", reportedAt: "2026-08-26T12:00:00.000Z", epsActual: 2.1, epsEstimate: 2.01, surprise: 0.0448 },
  ],
  estimates: [estimate("0q", 2.47, { analysts: 41 }), estimate("+1q", 2.8)],
};

function bar(date: string, close: number): DailyBar {
  return { t: Date.parse(`${date}T00:00:00Z`), o: close, h: close, l: close, c: close, adjClose: close, v: 1 };
}

const BARS: DailyBar[] = [
  bar("2025-11-19", 100),
  bar("2025-11-20", 98),
  bar("2026-02-25", 100),
  bar("2026-02-26", 110),
  bar("2026-05-26", 100),
  bar("2026-05-27", 102),
  bar("2026-05-28", 95),
  bar("2026-08-25", 100),
  bar("2026-08-26", 103),
  bar("2026-08-27", 90),
];

describe("report reactions", () => {
  it("reads the report time from the UTC timestamp", () => {
    expect(reportTiming("2026-08-26T12:00:00.000Z")).toBe("before");
    expect(reportTiming("2026-02-25T21:20:00.000Z")).toBe("after");
    expect(reportTiming("2026-05-27T00:00:00.000Z")).toBe("unknown");
    expect(reportTiming("2026-05-27")).toBe("unknown");
  });

  it("measures the first session after each report, or a two-session window when the time is unknown", () => {
    const reactions = reportReactions(DETAIL.history, BARS);
    expect(reactions.map((r) => r.date)).toEqual(["2026-08-26", "2026-05-27", "2026-02-25", "2025-11-19"]);
    // Before the open: the report day against the day before.
    expect(reactions[0].move).toBeCloseTo(0.03, 10);
    expect(reactions[0].basis).toBe("next");
    // Unknown time: the close before the report day to the close after it.
    expect(reactions[1].move).toBeCloseTo(-0.05, 10);
    expect(reactions[1].basis).toBe("window");
    // After the close: the next day against the report day.
    expect(reactions[2].move).toBeCloseTo(0.1, 10);
    expect(reactions[3].move).toBeCloseTo(-0.02, 10);
  });

  it("skips reports the bars do not cover and keeps at most the limit", () => {
    expect(reportReactions(DETAIL.history, BARS.slice(0, 2))).toHaveLength(1);
    expect(reportReactions(DETAIL.history, BARS, 2)).toHaveLength(2);
    expect(reportReactions(DETAIL.history, [])).toEqual([]);
  });
});

describe("estimates", () => {
  it("uses the current quarter unless it still carries the estimate of the quarter just reported", () => {
    expect(lastReported(DETAIL.history)?.period).toBe("2Q2026");
    expect(upcomingEstimate(DETAIL)?.period).toBe("0q");
    const stale = { ...DETAIL, estimates: [estimate("0q", 2.01), estimate("+1q", 2.8)] };
    expect(upcomingEstimate(stale)?.period).toBe("+1q");
    expect(upcomingEstimate({ ...DETAIL, estimates: [estimate("0q", 2.01)] })).toBeNull();
  });

  it("prefers the calendar consensus and drops it when it is stale", () => {
    expect(upcomingConsensus(DETAIL)).toMatchObject({ epsAvg: 2.47, analysts: 41, revenueAvg: 108.98e9 });
    const staleCalendar = { ...DETAIL, consensus: { ...DETAIL.consensus!, epsAvg: 2.01 } };
    expect(upcomingConsensus(staleCalendar)).toMatchObject({ epsAvg: 2.47, revenueAvg: 100e9, analysts: 41 });
    expect(upcomingConsensus({ ...DETAIL, consensus: null, estimates: [] })).toBeNull();
  });
});

describe("earningsBlock", () => {
  it("writes the date, consensus, estimate trend, surprises, reactions and the into-the-report marker", () => {
    const text = earningsBlock({ detail: DETAIL, bars: BARS, currency: "USD", now: NOW }) ?? "";
    expect(text).toContain("Earnings (Yahoo; consensus figures and estimates are analyst opinions):");
    expect(text).toContain("- next report: 2026-11-19 (confirmed), in 12 days");
    expect(text).toContain("- consensus for the upcoming report: EPS 2.47 (range 2.34-2.70, 41 analysts); revenue $108.98B (range $104.94B-$116.25B)");
    expect(text).toContain("- EPS estimate for the upcoming report: 2.47 now, 2.40 30 days ago (+2.9% since), 2.30 90 days ago (+7.4% since); revisions in the last 30 days: 12 up, 2 down");
    expect(text).toContain("- last 4 reports, newest first: 2Q2026 EPS 2.10 vs estimate 2.01 (surprise +4.5%); 1Q2026 EPS 1.83");
    expect(text).toContain("2026-08-26 +3.0%, 2026-05-27 -5.0%, 2026-02-25 +10.0%, 2025-11-19 -2.0%");
    expect(text).toContain("where the report time is unknown, from the close before the report date");
    expect(text).toContain("- Into the report: the next report is 14 days away or less.");
  });

  it("says when the date is only Yahoo's estimate and leaves the marker out further ahead", () => {
    const text = earningsBlock({ detail: { ...DETAIL, nextDate: "2026-12-20", nextDateEstimated: true }, bars: null, currency: "USD", now: NOW }) ?? "";
    expect(text).toContain("(estimated by Yahoo, not confirmed by the company), in 43 days");
    expect(text).not.toContain("Into the report");
    expect(text).not.toContain("price move after");
  });

  it("flags figures in another currency and falls back to the quote's date without detail", () => {
    expect(earningsBlock({ detail: { ...DETAIL, financialCurrency: "CNY" }, bars: null, currency: "HKD", now: NOW })).toContain("(Yahoo; financial figures in CNY;");
    const fallback = earningsBlock({ detail: null, bars: null, currency: "USD", quoteNextDate: "2026-11-10T00:00:00.000Z", quoteDateEstimated: true, now: NOW });
    expect(fallback).toContain("- next report: 2026-11-10 (estimated by Yahoo, not confirmed by the company), in 3 days");
    expect(fallback).toContain("Into the report");
    expect(earningsBlock({ detail: null, bars: null, currency: "USD", now: NOW })).toBeNull();
  });

  it("knows when the report is close", () => {
    expect(isIntoReport("2026-11-21", NOW)).toBe(true);
    expect(isIntoReport("2026-11-22", NOW)).toBe(false);
    expect(isIntoReport("2026-11-01", NOW)).toBe(false);
    expect(isIntoReport(null, NOW)).toBe(false);
  });
});

const ACTIVITY: AnalystActivity = {
  symbol: "NVDA",
  asOf: "2026-11-07T15:00:00.000Z",
  trend: [
    { period: "0m", strongBuy: 20, buy: 30, hold: 7, sell: 1, strongSell: 0 },
    { period: "-1m", strongBuy: 19, buy: 30, hold: 8, sell: 1, strongSell: 0 },
    { period: "-2m", strongBuy: 19, buy: 29, hold: 9, sell: 1, strongSell: 0 },
    { period: "-3m", strongBuy: 18, buy: 29, hold: 9, sell: 1, strongSell: 0 },
  ],
  actions: [
    { date: "2026-11-03T00:00:00.000Z", firm: "Mizuho", fromGrade: "Neutral", toGrade: "Outperform", action: "up", priceTargetAction: "Raises", currentTarget: 240, priorTarget: 200 },
    { date: "2026-11-05T00:00:00.000Z", firm: "Morgan Stanley", fromGrade: "Overweight", toGrade: "Overweight", action: "main", priceTargetAction: "Raises", currentTarget: 250, priorTarget: 220 },
    { date: "2026-09-01T00:00:00.000Z", firm: "Old Firm", fromGrade: null, toGrade: "Buy", action: "init", priceTargetAction: null, currentTarget: null, priorTarget: null },
  ],
  targetMean: 230.5,
  targetHigh: 300,
  targetLow: 160,
  numberOfAnalysts: 57,
};

describe("analystBlock", () => {
  it("compares rating counts with three months ago and lists recent actions newest first", () => {
    const text = analystBlock(ACTIVITY, NOW) ?? "";
    expect(text).toContain("Analyst activity (ratings and price targets are opinions, not facts about the future):");
    expect(text).toContain("- ratings now: strong buy 20, buy 30, hold 7, sell 1, strong sell 0 (58 ratings); 3 months ago: strong buy 18, buy 29, hold 9, sell 1, strong sell 0 (57 ratings)");
    expect(text).toContain("- price targets: mean 230.50, range 160.00-300.00, 57 analysts");
    expect(text).toContain(
      "- actions in the last 30 days, newest first: 2026-11-05 Morgan Stanley: maintains Overweight; target 220.00 -> 250.00 (raises); 2026-11-03 Mizuho: upgrade from Neutral to Outperform; target 200.00 -> 240.00 (raises)",
    );
    expect(text).not.toContain("Old Firm");
  });

  it("says when nothing happened and is null without data", () => {
    expect(analystBlock({ ...ACTIVITY, actions: [] }, NOW)).toContain("- no rating or target actions in the last 30 days");
    expect(analystBlock(null, NOW)).toBeNull();
  });

  it("describes single actions and filters by age", () => {
    expect(actionText({ date: "2026-11-01", firm: "<b>Firm</b>", fromGrade: null, toGrade: "Buy", action: "init", priceTargetAction: "Announces", currentTarget: 9.5, priorTarget: null })).toBe(
      "2026-11-01 bFirm/b: initiates Buy; target 9.50 (announces)",
    );
    expect(recentActions(ACTIVITY, NOW, 5).map((action) => action.firm)).toEqual(["Morgan Stanley", "Mizuho"]);
    expect(recentActions(null, NOW, 5)).toEqual([]);
  });
});
