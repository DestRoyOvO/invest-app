import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dividendSchedule, earningsSchedule, quarterEndOnOrBefore, quarterResult, shiftQuarterEnd, trailingEps } from "./company";
import { buildQuote } from "./quote";
import { securityOf, TABLE_SECURITIES } from "./securities";
import { buildSummary } from "./summary";
import { buildFundamentals } from "./timeseries";
import { dayKey, localToUtc, nextTradingDay, parseDayKey, PROFILES, sessionClose, tradingDaysBetween } from "./sessions";

// Sweeps over every session of the coming years: the event schedules must stay consistent on every day a test run
// can land on, not only on the day the suite was written. The schedules move with the latest completed session, so a
// mistake that shows on a few days a quarter (two reports for one quarter, a report dated after the session) is
// caught here rather than on the day CI happens to run.

const DAY = 86_400_000;
const STOCKS = TABLE_SECURITIES.filter((security) => security.type === "EQUITY");
const TWO_YEARS = tradingDaysBetween(PROFILES.us, parseDayKey("2026-11-02"), parseDayKey("2028-10-31"));

describe("quarter arithmetic", () => {
  it("steps between calendar quarter ends", () => {
    expect(dayKey(shiftQuarterEnd(parseDayKey("2026-09-30"), -3))).toBe("2026-06-30");
    expect(dayKey(shiftQuarterEnd(parseDayKey("2026-03-31"), -3))).toBe("2025-12-31");
    expect(dayKey(shiftQuarterEnd(parseDayKey("2026-12-31"), 3))).toBe("2027-03-31");
    expect(dayKey(shiftQuarterEnd(parseDayKey("2026-06-30"), -24))).toBe("2024-06-30");
    expect(dayKey(quarterEndOnOrBefore(parseDayKey("2026-11-07")))).toBe("2026-09-30");
    expect(dayKey(quarterEndOnOrBefore(parseDayKey("2026-09-30")))).toBe("2026-09-30");
    expect(dayKey(quarterEndOnOrBefore(parseDayKey("2026-01-01")))).toBe("2025-12-31");
  });

  it("gives a quarter the same results whenever it is asked for", () => {
    const aapl = securityOf("AAPL")!;
    const quarter = parseDayKey("2026-06-30");
    const reportedThen = earningsSchedule(aapl, parseDayKey("2026-11-06"))!.history.find((report) => report.periodEnd === quarter);
    const reportedLater = earningsSchedule(aapl, parseDayKey("2027-03-05"))!.history.find((report) => report.periodEnd === quarter);
    expect(reportedThen?.epsActual).toBe(quarterResult(aapl, quarter).eps);
    expect(reportedLater?.epsActual).toBe(reportedThen?.epsActual);
    expect(reportedLater?.revenueActual).toBe(reportedThen?.revenueActual);
  });
});

describe("earnings schedules on every session of two years", () => {
  it("report consecutive quarters, each after it ended, the last before now and the next after it", () => {
    const problems: string[] = [];
    for (const security of STOCKS) {
      for (const latest of TWO_YEARS) {
        const schedule = earningsSchedule(security, latest)!;
        const reports = [...schedule.history, schedule.next];
        const where = `${security.symbol} at ${dayKey(latest)}`;
        for (let i = 1; i < reports.length; i++) {
          if (reports[i].periodEnd !== shiftQuarterEnd(reports[i - 1].periodEnd, 3)) problems.push(`${where}: quarter after ${dayKey(reports[i - 1].periodEnd)} is ${dayKey(reports[i].periodEnd)}`);
          if (reports[i].day <= reports[i - 1].day) problems.push(`${where}: report days out of order`);
        }
        for (const report of reports) {
          if (report.day - report.periodEnd < 15) problems.push(`${where}: ${dayKey(report.periodEnd)} reported ${report.day - report.periodEnd} days after it ended`);
        }
        // `latest` is the latest completed session from its close until the next session closes.
        const last = schedule.history.at(-1)!;
        if (last.at > sessionClose(security.profile, latest)) problems.push(`${where}: the last report (${new Date(last.at).toISOString()}) is not out yet at the close`);
        if (schedule.next.at <= sessionClose(security.profile, nextTradingDay(security.profile, latest))) problems.push(`${where}: the next report is out before the next session closes`);
        if (schedule.history.some((report) => report.epsActual === null) || schedule.next.epsActual !== null) problems.push(`${where}: actuals on the wrong reports`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("date past dividends on or before the latest session, in order", () => {
    const problems: string[] = [];
    for (const security of STOCKS) {
      for (const latest of TWO_YEARS) {
        const schedule = dividendSchedule(security, latest);
        if (!schedule) continue;
        const days = schedule.history.map((payment) => payment.exDay);
        if (days.some((day, i) => day > latest || (i > 0 && day <= days[i - 1]))) problems.push(`${security.symbol} at ${dayKey(latest)}`);
        if (schedule.next.exDay <= latest) problems.push(`${security.symbol} at ${dayKey(latest)}: next ex-date not ahead`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });
});

describe("quotes and summaries on every session of a year", () => {
  const SYMBOLS = ["NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "HON", "FUTU"];
  const YEAR = tradingDaysBetween(PROFILES.us, parseDayKey("2026-11-02"), parseDayKey("2027-10-29"));
  // Before the open, during the session and two minutes after the close (a report released at 16:05 is not out yet).
  const MOMENTS = [8 * 60, 12 * 60, 16 * 60 + 2];

  it("put the last report before now and the next after it, with the same trailing EPS and P/E", () => {
    const problems: string[] = [];
    for (const symbol of SYMBOLS) {
      const security = securityOf(symbol)!;
      for (const day of YEAR) {
        for (const minutes of MOMENTS) {
          const now = localToUtc("America/New_York", day, minutes);
          const where = `${symbol} at ${new Date(now).toISOString()}`;
          const quote = buildQuote(security, now)!;
          const last = (quote.earningsTimestamp as Date | undefined)?.getTime() ?? Infinity;
          const next = (quote.earningsTimestampStart as Date).getTime();
          if (!(last <= now && now < next)) problems.push(`${where}: last ${new Date(last).toISOString()}, next ${new Date(next).toISOString()}`);
          const price = quote.regularMarketPrice as number;
          if (price > (quote.fiftyTwoWeekHigh as number) || price < (quote.fiftyTwoWeekLow as number)) problems.push(`${where}: price outside the 52-week range`);
          if (minutes !== 12 * 60) continue;
          const summary = buildSummary(symbol, { modules: ["summaryDetail", "defaultKeyStatistics"] }, now);
          const detail = summary.summaryDetail as Record<string, number>;
          const stats = summary.defaultKeyStatistics as Record<string, number>;
          if (stats.trailingEps !== quote.epsTrailingTwelveMonths) problems.push(`${where}: EPS ${String(quote.epsTrailingTwelveMonths)} vs ${stats.trailingEps}`);
          if (detail.trailingPE !== quote.trailingPE) problems.push(`${where}: P/E ${String(quote.trailingPE)} vs ${detail.trailingPE}`);
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("agree with the trailing and quarterly fundamentals", () => {
    const now = Date.parse("2027-01-12T17:00:00Z");
    const aapl = securityOf("AAPL")!;
    const schedule = earningsSchedule(aapl, parseDayKey("2027-01-11"))!;
    const quarterly = buildFundamentals("AAPL", { period1: new Date(now - 900 * DAY), type: "quarterly", module: "financials" }, now);
    const ends = quarterly.map((row) => (row.date as Date).getTime());
    expect(new Set(ends).size).toBe(ends.length);
    expect(ends.at(-1)).toBe(schedule.history.at(-1)!.periodEnd * DAY);
    const [trailing] = buildFundamentals("AAPL", { period1: new Date(now - 900 * DAY), type: "trailing", module: "financials" }, now);
    expect(trailing.dilutedEPS).toBe(trailingEps(schedule));
    expect((buildQuote(aapl, now)!.epsTrailingTwelveMonths as number)).toBe(trailingEps(schedule));
  });
});
