import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiErrorBody } from "@/types/api";
import type { YieldCurveResponse } from "@/types/markets";

vi.mock("server-only", () => ({}));

import { GET as curveRoute } from "@/app/api/rates/curve/route";

import { clearCache } from "./cache";
import {
  buildYieldCurve,
  getYieldCurve,
  headerMonths,
  mergeObservations,
  monthsBefore,
  observationOnOrBefore,
  parseTreasuryCsv,
  parseTreasuryDate,
  splitCsvLine,
  spreadBp,
  treasuryCsvUrl,
  treasuryYear,
  TreasuryFormatError,
  uncachedRatesCalls,
  type TreasuryFetch,
  type YieldObservation,
} from "./rates";

const fixture = (year: number) => readFileSync(new URL(`./__fixtures__/treasury-${year}.csv`, import.meta.url), "utf8");
const CSV_2025 = fixture(2025);
const CSV_2026 = fixture(2026);
/** A Saturday after the last fixture session (Friday 2026-11-06). */
const NOW = new Date("2026-11-07T15:00:00Z");

function csvResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "text/csv; charset=UTF-8" } });
}

/** A fetch that serves the fixtures by year and records the URLs it was asked for. */
function fixtureFetch(overrides: Partial<Record<number, () => Promise<Response>>> = {}) {
  const urls: string[] = [];
  const impl: TreasuryFetch = async (url) => {
    urls.push(url);
    const year = Number(/csv\/(\d{4})\//.exec(url)?.[1]);
    const override = overrides[year];
    if (override) return override();
    if (year === 2026) return csvResponse(CSV_2026);
    if (year === 2025) return csvResponse(CSV_2025);
    return csvResponse("", 404);
  };
  return { impl, urls };
}

beforeEach(() => {
  clearCache();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("CSV helpers", () => {
  it("splits quoted and unquoted fields", () => {
    expect(splitCsvLine('Date,"1 Mo","1.5 Month", 2 Mo ')).toEqual(["Date", "1 Mo", "1.5 Month", "2 Mo"]);
    expect(splitCsvLine('a,"b, c","say ""hi"""')).toEqual(["a", "b, c", 'say "hi"']);
    expect(splitCsvLine("11/06/2026,4.02,,4.15")).toEqual(["11/06/2026", "4.02", "", "4.15"]);
  });

  it("reads tenor headers in months", () => {
    expect(headerMonths("1 Mo")).toBe(1);
    expect(headerMonths("1.5 Month")).toBe(1.5);
    expect(headerMonths("4 Mo")).toBe(4);
    expect(headerMonths("10 Yr")).toBe(120);
    expect(headerMonths("30 yrs")).toBe(360);
    expect(headerMonths("Date")).toBeNull();
    expect(headerMonths("Extrapolation Factor")).toBeNull();
  });

  it("parses US and ISO dates and rejects impossible ones", () => {
    expect(parseTreasuryDate("11/06/2026")).toBe("2026-11-06");
    expect(parseTreasuryDate("1/2/2026")).toBe("2026-01-02");
    expect(parseTreasuryDate("2026-11-06")).toBe("2026-11-06");
    expect(parseTreasuryDate("02/30/2026")).toBeNull();
    expect(parseTreasuryDate("13/01/2026")).toBeNull();
    expect(parseTreasuryDate("Nov 6, 2026")).toBeNull();
    expect(parseTreasuryDate("")).toBeNull();
  });

  it("moves dates back by months, clamping the day", () => {
    expect(monthsBefore("2026-11-06", 1)).toBe("2026-10-06");
    expect(monthsBefore("2026-11-06", 12)).toBe("2025-11-06");
    expect(monthsBefore("2026-03-31", 1)).toBe("2026-02-28");
    expect(monthsBefore("2024-03-31", 1)).toBe("2024-02-29");
    expect(monthsBefore("2026-01-15", 1)).toBe("2025-12-15");
  });
});

describe("parseTreasuryCsv", () => {
  it("parses the published file into sorted observations", () => {
    const rows = parseTreasuryCsv(CSV_2026);
    expect(rows).toHaveLength(30);
    expect(rows[0].date).toBe("2026-01-02");
    const last = rows[rows.length - 1];
    expect(last.date).toBe("2026-11-06");
    expect(last.yields).toEqual({
      "1M": 4.02,
      "6W": 4.07,
      "2M": 4.15,
      "3M": 4.19,
      "4M": 4.19,
      "6M": 4.23,
      "1Y": 4.33,
      "2Y": 4.51,
      "3Y": 4.59,
      "5Y": 4.64,
      "7Y": 4.74,
      "10Y": 4.86,
      "20Y": 5.29,
      "30Y": 5.26,
    });
  });

  it("leaves blank tenors out and keeps extra decimals", () => {
    const rows = parseTreasuryCsv(CSV_2025);
    const early = rows.find((row) => row.date === "2025-02-14");
    expect(early?.yields["6W"]).toBeUndefined();
    expect(early?.yields["1M"]).toBe(4.37);
    expect(rows.find((row) => row.date === "2025-01-02")?.yields["30Y"]).toBe(4.79);
    expect(parseTreasuryCsv('Date,"30 Yr"\n01/02/2025,4.7931')[0].yields["30Y"]).toBe(4.7931);
  });

  it("matches columns by header, whatever their order, and ignores unknown ones", () => {
    const text = ['"10 Yr",Date,"Note","2 Yr"', "4.86,11/06/2026,x,4.51", "4.84,11/05/2026,y,4.46"].join("\r\n");
    expect(parseTreasuryCsv(text)).toEqual([
      { date: "2026-11-05", yields: { "10Y": 4.84, "2Y": 4.46 } },
      { date: "2026-11-06", yields: { "10Y": 4.86, "2Y": 4.51 } },
    ]);
  });

  it("skips bad rows and implausible cells", () => {
    const text = [
      "﻿Date,1 Mo,10 Yr",
      "11/06/2026,4.02,4.86",
      "not a date,4.00,4.80",
      "11/05/2026,N/A,",
      "11/04/2026,99,4.90",
      "",
      "11/03/2026,4.03,4.95,extra",
      "11/03/2026,4.04,4.96",
    ].join("\n");
    expect(parseTreasuryCsv(text)).toEqual([
      { date: "2026-11-03", yields: { "1M": 4.04, "10Y": 4.96 } },
      { date: "2026-11-04", yields: { "10Y": 4.9 } },
      { date: "2026-11-06", yields: { "1M": 4.02, "10Y": 4.86 } },
    ]);
  });

  it("accepts a file with only the header and rejects other files", () => {
    expect(parseTreasuryCsv('Date,"1 Mo","10 Yr"\n')).toEqual([]);
    expect(() => parseTreasuryCsv("")).toThrow(TreasuryFormatError);
    expect(() => parseTreasuryCsv("<!DOCTYPE html><html><body>Maintenance</body></html>")).toThrow(TreasuryFormatError);
    expect(() => parseTreasuryCsv("Date,Price\n11/06/2026,1")).toThrow(TreasuryFormatError);
  });
});

describe("buildYieldCurve", () => {
  const observations = mergeObservations([parseTreasuryCsv(CSV_2025), parseTreasuryCsv(CSV_2026)]);

  it("finds the observation on or before a date", () => {
    expect(observationOnOrBefore(observations, "2026-10-04")?.date).toBe("2026-10-02");
    expect(observationOnOrBefore(observations, "2024-12-31")).toBeNull();
  });

  it("computes spreads in basis points", () => {
    const latest = observations[observations.length - 1];
    expect(spreadBp(latest, "10Y", "2Y")).toBe(35);
    expect(spreadBp(latest, "10Y", "3M")).toBe(67);
    expect(spreadBp({ date: "2026-11-06", yields: { "10Y": 4.86 } }, "10Y", "2Y")).toBeNull();
  });

  it("returns today's curve with the curves a month and a year earlier", () => {
    const curve = buildYieldCurve(observations, false, NOW) as YieldCurveResponse;
    expect(curve.current.date).toBe("2026-11-06");
    expect(curve.monthAgo?.date).toBe("2026-10-06");
    expect(curve.yearAgo?.date).toBe("2025-11-06");
    expect(curve.tenors).toEqual(["1M", "6W", "2M", "3M", "4M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]);
    expect(curve.current.yields[curve.tenors.indexOf("10Y")]).toBe(4.86);
    expect(curve.yearAgo?.yields[curve.tenors.indexOf("10Y")]).toBe(4.11);
    expect(curve.asOf).toBe(NOW.toISOString());
    expect(curve.stale).toBe(false);
  });

  it("keeps a year of spread history and counts inverted days", () => {
    const curve = buildYieldCurve(observations, false, NOW) as YieldCurveResponse;
    const twos = curve.spreads.find((spread) => spread.key === "2s10s");
    expect(twos?.bp).toBe(35);
    expect(twos?.monthAgoBp).toBe(48);
    expect(twos?.history[0].date).toBe("2025-11-07");
    expect(twos?.history[twos.history.length - 1]).toEqual({ date: "2026-11-06", bp: 35 });
    expect(twos?.invertedDays).toBe(0);

    const inverted: YieldObservation[] = [
      { date: "2026-01-02", yields: { "3M": 5, "2Y": 4.8, "10Y": 4.5 } },
      { date: "2026-01-05", yields: { "3M": 4.6, "2Y": 4.4, "10Y": 4.5 } },
    ];
    const short = buildYieldCurve(inverted, false, NOW) as YieldCurveResponse;
    expect(short.spreads.map((spread) => [spread.key, spread.bp, spread.invertedDays])).toEqual([
      ["2s10s", 10, 1],
      ["3m10y", -10, 2],
    ]);
    expect(short.monthAgo).toBeNull();
    expect(short.tenors).toEqual(["3M", "2Y", "10Y"]);
  });

  it("needs an observation with a 10-year yield", () => {
    expect(buildYieldCurve([])).toBeNull();
    expect(buildYieldCurve([{ date: "2026-11-06", yields: { "1M": 4 } }])).toBeNull();
  });
});

describe("getYieldCurve", () => {
  it("downloads this year and last year from Treasury", async () => {
    const { impl, urls } = fixtureFetch();
    const curve = await getYieldCurve({ now: NOW, fetchImpl: impl });
    expect(urls.sort()).toEqual([treasuryCsvUrl(2025), treasuryCsvUrl(2026)].sort());
    expect(urls[0]).toMatch(/^https:\/\/home\.treasury\.gov\/resource-center\/data-chart-center\/interest-rates\/daily-treasury-rates\.csv\//);
    expect(curve.current.date).toBe("2026-11-06");
    expect(curve.yearAgo?.date).toBe("2025-11-06");
    expect(curve.stale).toBe(false);
  });

  it("serves the cached files until they expire", async () => {
    const { impl, urls } = fixtureFetch();
    await getYieldCurve({ now: NOW, fetchImpl: impl });
    expect(uncachedRatesCalls(NOW)).toBe(0);
    await getYieldCurve({ now: NOW, fetchImpl: impl });
    expect(urls).toHaveLength(2);
  });

  it("falls back to last year when this year's download fails, and says so", async () => {
    const { impl } = fixtureFetch({ 2026: async () => csvResponse("Service Unavailable", 503) });
    const curve = await getYieldCurve({ now: NOW, fetchImpl: impl });
    expect(curve.current.date).toBe("2025-12-31");
    expect(curve.stale).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("rates.download_failed"));
  });

  it("fails when neither year can be downloaded", async () => {
    const { impl } = fixtureFetch({ 2026: () => Promise.reject(new Error("ECONNRESET")), 2025: async () => csvResponse("<html></html>") });
    await expect(getYieldCurve({ now: NOW, fetchImpl: impl })).rejects.toThrow("ECONNRESET");
  });

  it("uses the New York calendar year", () => {
    expect(treasuryYear(new Date("2027-01-01T03:00:00Z"))).toBe(2026);
    expect(treasuryYear(new Date("2027-01-01T06:00:00Z"))).toBe(2027);
  });
});

describe("GET /api/rates/curve", () => {
  it("returns the curve with a shared cache lifetime", async () => {
    const { impl } = fixtureFetch();
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => impl(String(input), init ?? {}));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      const response = await curveRoute(new Request("http://localhost/api/rates/curve"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toMatch(/s-maxage=1800(?!\d)/);
      const body = (await response.json()) as YieldCurveResponse;
      expect(body.current.date).toBe("2026-11-06");
      expect(body.spreads.map((spread) => spread.key)).toEqual(["2s10s", "3m10y"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers a generic 502 when Treasury is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED 10.0.0.7:443"));
    const response = await curveRoute(new Request("http://localhost/api/rates/curve"));
    expect(response.status).toBe(502);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("upstream_error");
    expect(body.error.message).not.toContain("10.0.0.7");
  });
});
