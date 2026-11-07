import { describe, expect, it } from "vitest";

import { calendarMessages } from "@/lib/i18n/calendar";
import type { CalendarEvent } from "@/types/api";

import {
  addDays,
  buildAgenda,
  daysBetween,
  eventDayKey,
  filterCounts,
  formatWeekSummary,
  isDateOnly,
  localTimeOf,
  macroListEnding,
  nyClock,
  nyDayKey,
  nyWeekday,
  pickTopItems,
  rangeWindow,
  relativeDay,
  summarizeWeek,
  toAgendaItem,
  weekdayOf,
  type AgendaInput,
  type EventFilter,
} from "./events";

const SATURDAY = Date.parse("2026-11-07T15:00:00Z");

function event(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "kind" | "at">): CalendarEvent {
  return { timing: null, estimated: false, symbol: null, name: null, macro: null, period: null, projections: false, amount: null, ...overrides };
}

const earnings = (symbol: string, at: string, timing: CalendarEvent["timing"], estimated = false) =>
  event({ id: `earnings:${symbol}:${at.slice(0, 10)}`, kind: "earnings", at, timing, estimated, symbol, name: `${symbol} Inc` });
const dividend = (symbol: string, at: string, amount: number | null) => event({ id: `dividend:${symbol}:${at.slice(0, 10)}`, kind: "dividend", at, symbol, name: `${symbol} Inc`, amount });
const macro = (key: "fomc" | "cpi" | "jobs", at: string, projections = false) => event({ id: `macro:${key}:${at.slice(0, 10)}`, kind: "macro", at, macro: key, projections });

const INPUT: AgendaInput = {
  holdings: { NVDA: { shares: 40, cost: 118.5 }, JPM: { shares: 10, cost: 200 } },
  watchlist: ["NVDA", "AAPL", "WMT"],
  universe: new Set(["NVDA", "AAPL", "JPM", "WMT", "HD"]),
  prices: new Map([["NVDA", { price: 186.64, currency: "USD" }]]),
};

describe("calendar days", () => {
  it("uses the New York date of timed events and the UTC date of date-only values", () => {
    expect(nyDayKey(Date.parse("2026-11-07T03:00:00Z"))).toBe("2026-11-06");
    expect(nyDayKey(Date.parse("2026-07-01T03:59:00Z"))).toBe("2026-06-30");
    expect(nyDayKey(Date.parse("2026-07-01T04:00:00Z"))).toBe("2026-07-01");
    expect(isDateOnly("2026-11-12T00:00:00.000Z")).toBe(true);
    expect(isDateOnly("2026-11-12T05:00:00.000Z")).toBe(false);
    // An ex-date from corporate actions is midnight in New York; a date-only value is UTC midnight.
    expect(eventDayKey("2026-11-12T05:00:00.000Z")).toBe("2026-11-12");
    expect(eventDayKey("2026-11-12T00:00:00.000Z")).toBe("2026-11-12");
    expect(eventDayKey("2026-11-18T01:30:00.000Z")).toBe("2026-11-17");
    expect(eventDayKey("garbage")).toBe("");
  });

  it("does day arithmetic across month ends and daylight saving", () => {
    expect(addDays("2026-11-28", 5)).toBe("2026-12-03");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-07", "2026-11-17")).toBe(10);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(weekdayOf("2026-11-07")).toBe(6);
    expect(weekdayOf("2026-11-09")).toBe(1);
  });
});

describe("rangeWindow", () => {
  it("shows the coming trading week on a weekend", () => {
    expect(rangeWindow("week", SATURDAY)).toEqual({ from: "2026-11-07", to: "2026-11-15" });
    expect(rangeWindow("next", SATURDAY)).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(rangeWindow("month", SATURDAY)).toEqual({ from: "2026-11-07", to: "2026-12-06" });
    expect(rangeWindow("week", Date.parse("2026-11-08T15:00:00Z"))).toEqual({ from: "2026-11-08", to: "2026-11-15" });
  });

  it("runs to Sunday on weekdays, by the New York date", () => {
    expect(rangeWindow("week", Date.parse("2026-11-11T15:00:00Z"))).toEqual({ from: "2026-11-11", to: "2026-11-15" });
    expect(rangeWindow("week", Date.parse("2026-11-09T15:00:00Z"))).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    // 01:00 UTC on Monday is still Sunday evening in New York.
    expect(rangeWindow("week", Date.parse("2026-11-09T01:00:00Z"))).toEqual({ from: "2026-11-08", to: "2026-11-15" });
    expect(rangeWindow("next", Date.parse("2026-11-13T15:00:00Z"))).toEqual({ from: "2026-11-16", to: "2026-11-22" });
  });
});

describe("toAgendaItem", () => {
  it("values held positions at the last price, or at cost while no price is known", () => {
    const nvda = toAgendaItem(earnings("NVDA", "2026-11-17T21:00:00.000Z", "post"), INPUT);
    expect(nvda).toMatchObject({ day: "2026-11-17", minute: 16 * 60, filters: ["holdings", "watchlist", "universe"], shares: 40, valueAtCost: false, currency: "USD" });
    expect(nvda.positionValue).toBeCloseTo(40 * 186.64, 8);
    const jpm = toAgendaItem(earnings("JPM", "2027-01-14T13:30:00.000Z", "pre"), INPUT);
    expect(jpm).toMatchObject({ positionValue: 2000, valueAtCost: true, currency: null });
    const aapl = toAgendaItem(earnings("AAPL", "2027-01-28T21:00:00.000Z", null, true), INPUT);
    expect(aapl).toMatchObject({ shares: null, positionValue: null, minute: null, filters: ["watchlist", "universe"] });
  });

  it("computes the dividend cash for holders", () => {
    expect(toAgendaItem(dividend("JPM", "2026-11-12T05:00:00.000Z", 1.5), INPUT)).toMatchObject({ dividendCash: 15, minute: null, day: "2026-11-12" });
    expect(toAgendaItem(dividend("WMT", "2026-11-12T05:00:00.000Z", 0.235), INPUT).dividendCash).toBeNull();
    expect(toAgendaItem(dividend("JPM", "2026-11-12T05:00:00.000Z", null), INPUT).dividendCash).toBeNull();
  });
});

describe("buildAgenda", () => {
  const events = [
    earnings("NVDA", "2026-11-17T21:00:00.000Z", "post"),
    earnings("HD", "2026-11-17T11:00:00.000Z", "pre"),
    earnings("WMT", "2026-11-17T12:00:00.000Z", null, true),
    macro("cpi", "2026-11-10T13:30:00.000Z"),
    macro("fomc", "2026-12-09T19:00:00.000Z", true),
    dividend("JPM", "2026-11-17T05:00:00.000Z", 1.5),
    earnings("JPM", "2026-11-17T15:00:00.000Z", "intraday"),
    // Before the window and unrelated to every filter.
    earnings("NVDA", "2026-11-05T21:00:00.000Z", "post"),
    earnings("ZZZ", "2026-11-12T21:00:00.000Z", "post"),
  ];

  it("keeps the window, counts every filter and orders each day by time", () => {
    const agenda = buildAgenda(events, INPUT, rangeWindow("month", SATURDAY), new Set<EventFilter>(["holdings", "watchlist", "universe", "macro"]));
    // The FOMC meeting on Dec 9 falls after the fourth week (Dec 6).
    expect(agenda.items).toHaveLength(6);
    expect(agenda.counts).toEqual({ holdings: 3, watchlist: 2, universe: 5, macro: 1 });
    expect(agenda.days.map((d) => d.day)).toEqual(["2026-11-10", "2026-11-17"]);
    expect(agenda.days[1].items.map((i) => i.event.id)).toEqual([
      "dividend:JPM:2026-11-17",
      "earnings:HD:2026-11-17",
      "earnings:JPM:2026-11-17",
      "earnings:NVDA:2026-11-17",
      "earnings:WMT:2026-11-17",
    ]);
    expect(agenda.shown).toBe(6);
  });

  it("shows only events matching an active filter", () => {
    const agenda = buildAgenda(events, INPUT, rangeWindow("week", SATURDAY), new Set<EventFilter>(["holdings"]));
    expect(agenda.counts).toEqual({ holdings: 0, watchlist: 0, universe: 0, macro: 1 });
    expect(agenda.days).toEqual([]);
    const next = buildAgenda(events, INPUT, rangeWindow("next", SATURDAY), new Set<EventFilter>(["holdings", "macro"]));
    expect(next.days.flatMap((d) => d.items.map((i) => i.event.id))).toEqual(["dividend:JPM:2026-11-17", "earnings:JPM:2026-11-17", "earnings:NVDA:2026-11-17"]);
    expect(filterCounts(next.items)).toEqual(next.counts);
  });
});

describe("pickTopItems", () => {
  it("keeps holdings first, then macro, then watchlist names, shown in time order", () => {
    const items = [
      earnings("AAPL", "2026-11-09T21:00:00.000Z", "post"),
      macro("cpi", "2026-11-10T13:30:00.000Z"),
      earnings("NVDA", "2026-11-12T21:00:00.000Z", "post"),
      earnings("HD", "2026-11-11T21:00:00.000Z", "post"),
      earnings("WMT", "2026-11-13T12:00:00.000Z", "pre"),
    ].map((e) => toAgendaItem(e, INPUT));
    const top = pickTopItems(items, 3);
    expect(top.items.map((i) => i.event.symbol ?? i.event.macro)).toEqual(["AAPL", "cpi", "NVDA"]);
    expect(top.hidden).toBe(2);
    expect(pickTopItems(items, 10).hidden).toBe(0);
  });
});

describe("relativeDay and clocks", () => {
  it("names nearby days", () => {
    expect(relativeDay("2026-11-07", "2026-11-07")).toEqual({ kind: "today", offset: 0 });
    expect(relativeDay("2026-11-08", "2026-11-07")).toEqual({ kind: "tomorrow", offset: 1 });
    expect(relativeDay("2026-11-06", "2026-11-07")).toEqual({ kind: "yesterday", offset: -1 });
    expect(relativeDay("2026-11-12", "2026-11-07")).toEqual({ kind: "weekday", offset: 5 });
    expect(relativeDay("2026-11-17", "2026-11-07")).toEqual({ kind: "date", offset: 10 });
  });

  it("adds the viewer's clock only when it differs from New York", () => {
    const fomc = Date.parse("2026-12-09T19:00:00Z");
    expect(nyClock(fomc)).toBe("14:00");
    expect(nyWeekday(fomc, "en")).toBe("Wed");
    expect(nyWeekday(fomc, "zh")).toBe("周三");
    expect(localTimeOf(fomc, "Asia/Shanghai")).toEqual({ time: "03:00", minute: 180, dayOffset: 1 });
    expect(localTimeOf(fomc, "America/Los_Angeles")).toEqual({ time: "11:00", minute: 660, dayOffset: 0 });
    expect(localTimeOf(fomc, "America/New_York")).toBeNull();
    expect(localTimeOf(fomc, "America/Toronto")).toBeNull();
    expect(localTimeOf(fomc, "Not/AZone")).toBeNull();
  });
});

describe("macroListEnding", () => {
  const window = rangeWindow("month", SATURDAY);
  it("warns when the macro dates on file run out soon or inside the window", () => {
    expect(macroListEnding("2027-12-10T13:30:00.000Z", window, SATURDAY)).toBe(false);
    expect(macroListEnding("2026-12-10T13:30:00.000Z", window, SATURDAY)).toBe(true);
    expect(macroListEnding("2026-12-01T13:30:00.000Z", { from: "2026-11-07", to: "2026-11-15" }, Date.parse("2026-10-01T00:00:00Z"))).toBe(false);
    expect(macroListEnding("not a date", window, SATURDAY)).toBe(false);
  });
});

describe("week summary", () => {
  const labels = calendarMessages.en.summary;

  it("counts reports and ex-dates for holdings and names the macro releases", () => {
    const items = [
      earnings("NVDA", "2026-11-17T21:00:00.000Z", "post"),
      earnings("JPM", "2026-11-17T15:00:00.000Z", "intraday"),
      dividend("JPM", "2026-11-17T05:00:00.000Z", 1.5),
      earnings("AAPL", "2026-11-18T21:00:00.000Z", "post"),
      earnings("HD", "2026-11-18T11:00:00.000Z", "pre"),
      macro("fomc", "2026-11-18T19:00:00.000Z"),
    ].map((e) => toAgendaItem(e, INPUT));
    const summary = summarizeWeek(items);
    expect(summary).toEqual({ holdingsReporting: 2, watchlistReporting: 1, holdingsExDividend: 1, macro: [{ key: "fomc", at: "2026-11-18T19:00:00.000Z", projections: false }] });
    expect(formatWeekSummary(summary, labels, "en")).toBe("2 holdings report · 1 watchlist name reports · 1 holding goes ex-dividend · FOMC Wed 14:00 ET");
    expect(formatWeekSummary(summary, calendarMessages.zh.summary, "zh")).toBe("2 只持仓发布财报 · 1 只自选股发布财报 · 1 只持仓除息 · FOMC 周三 美东 14:00");
  });

  it("matches the example line and says when nothing is scheduled", () => {
    const items = [
      earnings("NVDA", "2026-11-17T21:00:00.000Z", "post"),
      earnings("JPM", "2026-11-18T11:00:00.000Z", "pre"),
      earnings("AAPL", "2026-11-18T21:00:00.000Z", "post"),
      macro("fomc", "2026-11-18T19:00:00.000Z"),
    ].map((e) => toAgendaItem(e, { ...INPUT, holdings: { ...INPUT.holdings, AAPL: { shares: 5, cost: 150 } } }));
    expect(formatWeekSummary(summarizeWeek(items), labels, "en")).toBe("3 holdings report · FOMC Wed 14:00 ET");
    expect(formatWeekSummary(summarizeWeek([]), labels, "en")).toBe("Nothing scheduled for your names");
  });

  it("names at most two macro releases", () => {
    const items = [macro("jobs", "2026-12-04T13:30:00.000Z"), macro("fomc", "2026-12-09T19:00:00.000Z", true), macro("cpi", "2026-12-10T13:30:00.000Z")].map((e) => toAgendaItem(e, INPUT));
    expect(formatWeekSummary(summarizeWeek(items), labels, "en")).toBe("Jobs report Fri 08:30 ET · FOMC Wed 14:00 ET");
  });
});
