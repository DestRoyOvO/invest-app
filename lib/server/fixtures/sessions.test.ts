import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  addTradingDays,
  dayKey,
  easterSunday,
  isNyseSession,
  latestCompletedSession,
  marketStateAt,
  nyseHolidays,
  parseDayKey,
  PROFILES,
  sessionClose,
  sessionOpen,
  tradingDaysBetween,
  type MarketProfile,
} from "./sessions";

const holidays = (year: number) => [...nyseHolidays(year)].sort((a, b) => a - b).map(dayKey);
const at = (iso: string) => Date.parse(iso);

describe("NYSE holiday calendar", () => {
  it("matches the exchange's published calendars", () => {
    expect(holidays(2021)).toEqual(["2021-01-01", "2021-01-18", "2021-02-15", "2021-04-02", "2021-05-31", "2021-07-05", "2021-09-06", "2021-11-25", "2021-12-24"]);
    expect(holidays(2022)).toEqual(["2022-01-17", "2022-02-21", "2022-04-15", "2022-05-30", "2022-06-20", "2022-07-04", "2022-09-05", "2022-11-24", "2022-12-26"]);
    expect(holidays(2024)).toEqual(["2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25"]);
    expect(holidays(2025)).toEqual(["2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"]);
    expect(holidays(2026)).toEqual(["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]);
    expect(holidays(2027)).toEqual(["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]);
  });

  it("does not observe a Saturday New Year's Day on the Friday before", () => {
    expect(isNyseSession(parseDayKey("2021-12-31"))).toBe(true);
    expect(isNyseSession(parseDayKey("2010-12-31"))).toBe(true);
    expect(holidays(2028)).not.toContain("2027-12-31");
  });

  it("includes the special closures", () => {
    for (const day of ["2001-09-11", "2001-09-14", "2004-06-11", "2007-01-02", "2012-10-29", "2012-10-30", "2018-12-05", "2025-01-09"]) {
      expect(isNyseSession(parseDayKey(day)), day).toBe(false);
    }
    expect(isNyseSession(parseDayKey("2001-09-17"))).toBe(true);
  });

  it("finds Easter (Good Friday is two days earlier)", () => {
    expect(dayKey(easterSunday(2026))).toBe("2026-04-05");
    expect(dayKey(easterSunday(2027))).toBe("2027-03-28");
    expect(dayKey(easterSunday(2000))).toBe("2000-04-23");
  });

  it("has a plausible number of sessions every year from 2000 to 2030", () => {
    for (let year = 2000; year <= 2030; year++) {
      const sessions = tradingDaysBetween(PROFILES.us, parseDayKey(`${year}-01-01`), parseDayKey(`${year}-12-31`)).length;
      expect(sessions, String(year)).toBeGreaterThanOrEqual(year === 2001 ? 248 : 250);
      expect(sessions, String(year)).toBeLessThanOrEqual(253);
    }
  });

  it("never trades on weekends", () => {
    expect(isNyseSession(parseDayKey("2026-11-07"))).toBe(false);
    expect(isNyseSession(parseDayKey("2026-11-08"))).toBe(false);
    expect(isNyseSession(parseDayKey("2026-11-09"))).toBe(true);
  });
});

describe("session times", () => {
  it("follows New York daylight saving time", () => {
    expect(new Date(sessionOpen(PROFILES.us, parseDayKey("2026-07-15"))).toISOString()).toBe("2026-07-15T13:30:00.000Z");
    expect(new Date(sessionOpen(PROFILES.us, parseDayKey("2026-12-15"))).toISOString()).toBe("2026-12-15T14:30:00.000Z");
    // The Monday after the clocks change on Sunday, March 8 and November 1, 2026.
    expect(new Date(sessionClose(PROFILES.us, parseDayKey("2026-03-09"))).toISOString()).toBe("2026-03-09T20:00:00.000Z");
    expect(new Date(sessionClose(PROFILES.us, parseDayKey("2026-11-02"))).toISOString()).toBe("2026-11-02T21:00:00.000Z");
  });

  it("knows other exchanges' hours and round-the-clock markets", () => {
    expect(new Date(sessionClose(PROFILES.tokyo, parseDayKey("2026-11-06"))).toISOString()).toBe("2026-11-06T06:30:00.000Z");
    expect(new Date(sessionOpen(PROFILES.futures, parseDayKey("2026-11-09"))).toISOString()).toBe("2026-11-08T23:00:00.000Z");
    expect(new Date(sessionClose(PROFILES.crypto, parseDayKey("2026-11-07"))).toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });
});

describe("latestCompletedSession", () => {
  const latest = (iso: string, profile: MarketProfile = PROFILES.us) => dayKey(latestCompletedSession(profile, at(iso)));

  it("moves only when a session closes", () => {
    expect(latest("2026-11-06T20:59:59Z")).toBe("2026-11-05");
    expect(latest("2026-11-06T21:00:00Z")).toBe("2026-11-06");
    expect(latest("2026-11-07T15:00:00Z")).toBe("2026-11-06");
    expect(latest("2026-11-09T14:00:00Z")).toBe("2026-11-06");
    expect(latest("2026-11-09T21:30:00Z")).toBe("2026-11-09");
  });

  it("skips holidays", () => {
    expect(latest("2026-11-27T12:00:00Z")).toBe("2026-11-25");
    expect(latest("2026-07-06T12:00:00Z")).toBe("2026-07-02");
  });

  it("works for other calendars", () => {
    expect(latest("2026-11-07T15:00:00Z", PROFILES.crypto)).toBe("2026-11-06");
    expect(latest("2026-11-08T00:00:01Z", PROFILES.crypto)).toBe("2026-11-07");
    expect(latest("2026-11-07T15:00:00Z", PROFILES.tokyo)).toBe("2026-11-06");
    expect(latest("2026-11-06T06:00:00Z", PROFILES.tokyo)).toBe("2026-11-05");
  });

  it("counts trading days forward and back", () => {
    expect(dayKey(addTradingDays(PROFILES.us, parseDayKey("2026-11-25"), 1))).toBe("2026-11-27");
    expect(dayKey(addTradingDays(PROFILES.us, parseDayKey("2026-11-27"), -1))).toBe("2026-11-25");
    expect(dayKey(addTradingDays(PROFILES.us, parseDayKey("2026-11-06"), 5))).toBe("2026-11-13");
  });
});

describe("marketStateAt", () => {
  it("follows the US session clock", () => {
    expect(marketStateAt(PROFILES.us, at("2026-11-06T08:00:00Z"))).toBe("CLOSED");
    expect(marketStateAt(PROFILES.us, at("2026-11-06T10:00:00Z"))).toBe("PRE");
    expect(marketStateAt(PROFILES.us, at("2026-11-06T15:00:00Z"))).toBe("REGULAR");
    expect(marketStateAt(PROFILES.us, at("2026-11-06T22:00:00Z"))).toBe("POST");
    expect(marketStateAt(PROFILES.us, at("2026-11-07T15:00:00Z"))).toBe("CLOSED");
    expect(marketStateAt(PROFILES.us, at("2026-11-26T15:00:00Z"))).toBe("CLOSED");
  });

  it("keeps crypto trading and futures on their evening session", () => {
    expect(marketStateAt(PROFILES.crypto, at("2026-11-07T15:00:00Z"))).toBe("REGULAR");
    expect(marketStateAt(PROFILES.futures, at("2026-11-09T00:30:00Z"))).toBe("REGULAR");
    expect(marketStateAt(PROFILES.futures, at("2026-11-07T15:00:00Z"))).toBe("CLOSED");
  });

  it("trades FX from Sunday 17:00 to Friday 17:00 New York time", () => {
    // 22:00 London is 17:00 New York in November 2026, both on standard time.
    expect(new Date(sessionClose(PROFILES.fx, parseDayKey("2026-11-06"))).toISOString()).toBe("2026-11-06T22:00:00.000Z");
    expect(new Date(sessionOpen(PROFILES.fx, parseDayKey("2026-11-09"))).toISOString()).toBe("2026-11-08T22:00:00.000Z");
    expect(marketStateAt(PROFILES.fx, at("2026-11-06T21:59:00Z"))).toBe("REGULAR");
    expect(marketStateAt(PROFILES.fx, at("2026-11-06T22:30:00Z"))).toBe("CLOSED");
    expect(marketStateAt(PROFILES.fx, at("2026-11-08T22:30:00Z"))).toBe("REGULAR");
    expect(dayKey(latestCompletedSession(PROFILES.fx, at("2026-11-06T21:59:00Z")))).toBe("2026-11-05");
    expect(dayKey(latestCompletedSession(PROFILES.fx, at("2026-11-06T22:00:00Z")))).toBe("2026-11-06");
  });
});
