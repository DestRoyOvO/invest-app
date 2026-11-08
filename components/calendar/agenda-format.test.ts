import { describe, expect, it } from "vitest";

import { toAgendaItem, type AgendaInput } from "@/lib/events";
import { calendarMessages } from "@/lib/i18n/calendar";
import type { CalendarEvent } from "@/types/api";

import { dayHeading, dayShort, formatMoney, glance, localLabel, macroDetail, markGlyph, marksLabel, periodMonthName, relativeLabel, timeLabel } from "./agenda-format";

const en = calendarMessages.en;
const zh = calendarMessages.zh;
const INPUT: AgendaInput = { holdings: {}, watchlist: [], universe: new Set(), prices: new Map() };

function item(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "kind" | "at">) {
  const event: CalendarEvent = { id: "x", timing: null, estimated: false, symbol: null, name: null, macro: null, period: null, projections: false, amount: null, ...overrides };
  return toAgendaItem(event, INPUT);
}

describe("timeLabel", () => {
  it("shows the session slot for reports, the ET time for macro releases and the ex-date for dividends", () => {
    expect(timeLabel(item({ kind: "earnings", at: "2026-11-17T21:00:00.000Z", timing: "post", symbol: "NVDA" }), en)).toBe("After close");
    expect(timeLabel(item({ kind: "earnings", at: "2027-01-28T21:00:00.000Z", estimated: true, symbol: "AAPL" }), en)).toBe("Time TBD");
    // A listing outside the US: no session slot, but the time is known.
    expect(timeLabel(item({ kind: "earnings", at: "2026-11-18T08:10:00.000Z", symbol: "0700.HK" }), en)).toBe("03:10 ET");
    expect(timeLabel(item({ kind: "earnings", at: "2026-11-18T00:00:00.000Z", symbol: "X" }), en)).toBe("Time TBD");
    expect(timeLabel(item({ kind: "macro", at: "2026-11-10T13:30:00.000Z", macro: "cpi" }), en)).toBe("08:30 ET");
    expect(timeLabel(item({ kind: "macro", at: "2026-12-09T19:00:00.000Z", macro: "fomc" }), zh)).toBe("美东 14:00");
    expect(timeLabel(item({ kind: "dividend", at: "2026-11-12T05:00:00.000Z", symbol: "AAPL", amount: 0.27 }), en)).toBe("Ex-date");
  });
});

describe("localLabel", () => {
  const fomc = item({ kind: "macro", at: "2026-12-09T19:00:00.000Z", macro: "fomc" });
  it("adds the viewer's clock only for timed events in another zone", () => {
    expect(localLabel(fomc, "Asia/Shanghai", en)).toBe("03:00 +1 day");
    expect(localLabel(fomc, "America/Los_Angeles", en)).toBe("11:00");
    expect(localLabel(item({ kind: "macro", at: "2026-11-10T13:30:00.000Z", macro: "cpi" }), "Pacific/Honolulu", en)).toBe("03:30");
    expect(localLabel(fomc, "America/New_York", en)).toBeNull();
    expect(localLabel(fomc, null, en)).toBeNull();
    expect(localLabel(item({ kind: "dividend", at: "2026-11-12T05:00:00.000Z" }), "Asia/Shanghai", en)).toBeNull();
    // A session slot has no clock time to convert (Yahoo's 21:00Z only says "after the close").
    expect(localLabel(item({ kind: "earnings", at: "2026-11-17T21:00:00.000Z", timing: "post", symbol: "NVDA" }), "Asia/Shanghai", en)).toBeNull();
    expect(localLabel(item({ kind: "earnings", at: "2026-11-18T08:10:00.000Z", symbol: "0700.HK" }), "Asia/Shanghai", zh)).toBe("16:10");
    // 00:30 in New York is still the evening before in Honolulu.
    expect(localLabel(item({ kind: "macro", at: "2026-11-09T05:30:00.000Z", macro: "cpi" }), "Pacific/Honolulu", en)).toBe("19:30 −1 day");
  });
});

describe("day labels", () => {
  it("formats headings and relative days", () => {
    expect(dayHeading("2026-11-09", "en")).toBe("Mon, Nov 9");
    expect(dayHeading("2026-11-09", "zh")).toBe("11月9日周一");
    expect(dayShort("2026-11-09", "en")).toBe("Mon");
    expect(relativeLabel("2026-11-07", "2026-11-07", en)).toBe("Today");
    expect(relativeLabel("2026-11-08", "2026-11-07", en)).toBe("Tomorrow");
    expect(relativeLabel("2026-11-10", "2026-11-07", en)).toBe("In 3 days");
    expect(relativeLabel("2026-11-10", "2026-11-07", zh)).toBe("3 天后");
    expect(relativeLabel("2026-11-20", "2026-11-07", en)).toBe("");
  });
});

describe("macro rows", () => {
  it("names the reference month and the projections", () => {
    expect(periodMonthName("2026-10", "en")).toBe("October");
    expect(periodMonthName("2026-10", "zh")).toBe("10月");
    expect(periodMonthName("bad", "en")).toBe("bad");
    expect(macroDetail(item({ kind: "macro", at: "2026-11-10T13:30:00.000Z", macro: "cpi", period: "2026-10" }), en, "en")).toBe("for October");
    expect(macroDetail(item({ kind: "macro", at: "2026-12-09T19:00:00.000Z", macro: "fomc", projections: true }), en, "en")).toBe("with projections");
    expect(macroDetail(item({ kind: "macro", at: "2027-01-27T19:00:00.000Z", macro: "fomc" }), en, "en")).toBeNull();
    expect(macroDetail(item({ kind: "earnings", at: "2026-11-17T21:00:00.000Z" }), en, "en")).toBeNull();
  });
});

describe("money and marks", () => {
  it("formats amounts at stake", () => {
    expect(formatMoney(7465.6, "USD", "en")).toBe("7,466");
    expect(formatMoney(15, "USD", "en", true)).toBe("15.00");
    expect(formatMoney(12345, "HKD", "en")).toBe("HKD 12,345");
    expect(formatMoney(812.5, null, "en")).toBe("812.50");
  });

  it("draws and reads the surprise marks", () => {
    const entries = [
      { period: "3Q2025", surprise: 0.03, mark: "beat" as const },
      { period: "4Q2025", surprise: -0.04, mark: "miss" as const },
      { period: "1Q2026", surprise: 0.001, mark: "inline" as const },
    ];
    expect(entries.map(markGlyph).join("")).toBe("+−=");
    expect(marksLabel(entries, en)).toBe("Last 3 reports vs the estimate: beat, missed, in line");
    expect(marksLabel([], en)).toBe("No reported quarters");
  });
});

describe("glance", () => {
  const input = {
    holdings: { NVDA: { shares: 40, cost: 118.5 }, JPM: { shares: 10, cost: 200 }, "0700.HK": { shares: 100, cost: 380 } },
    watchlist: ["AAPL", "NVDA"],
    universe: new Set<string>(),
    prices: new Map([
      ["NVDA", { price: 186.64, currency: "USD" }],
      ["JPM", { price: 300, currency: "USD" }],
      ["0700.HK", { price: 419.8, currency: "HKD" }],
    ]),
  };
  const ev = (id: string, kind: CalendarEvent["kind"], symbol: string | null, extra: Partial<CalendarEvent> = {}) =>
    toAgendaItem({ id, kind, at: "2026-11-17T21:00:00.000Z", timing: "post", estimated: false, symbol, name: symbol, macro: null, period: null, projections: false, amount: null, ...extra }, input);

  it("adds up what reports and pays in the period, by the largest currency group", () => {
    const g = glance([
      ev("1", "earnings", "NVDA"),
      ev("2", "earnings", "JPM"),
      ev("3", "earnings", "0700.HK"),
      ev("4", "earnings", "AAPL"),
      ev("5", "dividend", "JPM", { amount: 1.5 }),
      ev("6", "macro", null, { macro: "cpi" }),
    ]);
    expect(g.reporting).toEqual(["NVDA", "JPM", "0700.HK"]);
    expect(g.reportingValue).toEqual({ value: 40 * 186.64 + 3000, currency: "USD" });
    expect(g.watchReporting).toEqual(["AAPL"]);
    expect(g.dividendCash).toEqual({ value: 15, currency: "USD" });
    expect(g.exDividend).toEqual(["JPM"]);
    expect(g.macro).toHaveLength(1);
    expect(glance([]).reportingValue).toBeNull();
  });
});
