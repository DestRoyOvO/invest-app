import "server-only";

import { readEnv } from "../env";

import { yieldOn } from "./curve";
import { dayNumber, latestCompletedSession, parseDayKey, PROFILES, tradingDaysBetween } from "./sessions";

// The US Treasury daily par yield curve CSV in fixture mode. treasuryCsv(year) prints the synthetic curve (curve.ts,
// the same model behind ^IRX, ^FVX, ^TNX and ^TYX) in the columns Treasury publishes, newest row first, up to the
// latest completed NYSE session; a year that has not started yet is an empty file, as Treasury serves it.
// fixtureTreasuryFetch is a fetch-compatible function for lib/server/rates.ts (its fetchImpl), so the Rates panel can
// run without network access, and treasuryFetch picks it or the global fetch by MARKET_DATA_SOURCE.

interface Tenor {
  header: string;
  years: number;
  /** First day Treasury published the column. */
  since: string;
}

const TENORS: readonly Tenor[] = [
  { header: "1 Mo", years: 1 / 12, since: "2001-07-31" },
  { header: "1.5 Month", years: 1.5 / 12, since: "2025-02-18" },
  { header: "2 Mo", years: 2 / 12, since: "2018-10-16" },
  { header: "3 Mo", years: 0.25, since: "1990-01-02" },
  { header: "4 Mo", years: 4 / 12, since: "2022-10-19" },
  { header: "6 Mo", years: 0.5, since: "1990-01-02" },
  { header: "1 Yr", years: 1, since: "1990-01-02" },
  { header: "2 Yr", years: 2, since: "1990-01-02" },
  { header: "3 Yr", years: 3, since: "1990-01-02" },
  { header: "5 Yr", years: 5, since: "1990-01-02" },
  { header: "7 Yr", years: 7, since: "1990-01-02" },
  { header: "10 Yr", years: 10, since: "1990-01-02" },
  { header: "20 Yr", years: 20, since: "1993-10-01" },
  { header: "30 Yr", years: 30, since: "1990-01-02" },
];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** One calendar year of the curve as Treasury's CSV ("" for a year with no published day yet). */
export function treasuryCsv(year: number, now: number = Date.now()): string {
  const latest = latestCompletedSession(PROFILES.us, now);
  const days = tradingDaysBetween(PROFILES.us, dayNumber(year, 1, 1), Math.min(dayNumber(year, 12, 31), latest));
  if (days.length === 0) return "";
  const columns = TENORS.filter((tenor) => parseDayKey(tenor.since) <= days[days.length - 1]);
  const header = ["Date", ...columns.map((tenor) => `"${tenor.header}"`)].join(",");
  const lines = [...days].reverse().map((day) => {
    const date = new Date(day * 86_400_000);
    const cells = columns.map((tenor) => (parseDayKey(tenor.since) <= day ? yieldOn(day, tenor.years).toFixed(2) : ""));
    return [`${pad2(date.getUTCMonth() + 1)}/${pad2(date.getUTCDate())}/${date.getUTCFullYear()}`, ...cells].join(",");
  });
  return [header, ...lines].join("\n") + "\n";
}

/** The year in a Treasury CSV URL (field_tdr_date_value=YYYY, or a /YYYY/ path segment). */
export function treasuryYearOf(url: string): number | null {
  const match = /field_tdr_date_value=(\d{4})/.exec(url) ?? /\/(\d{4})\/all\b/.exec(url);
  return match ? Number(match[1]) : null;
}

/**
 * A fetch-compatible stand-in for Treasury's download: answers a yield-curve CSV URL with treasuryCsv(year) and any
 * other URL with 404, without network access.
 */
export async function fixtureTreasuryFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  void init;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const year = /daily_treasury_yield_curve/.test(url) ? treasuryYearOf(url) : null;
  if (year === null) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  return new Response(treasuryCsv(year), { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } });
}

/**
 * The fetch the Treasury download should use by default (lib/server/rates.ts of the overview branch:
 * `options.fetchImpl ?? treasuryFetch`): fixtureTreasuryFetch while MARKET_DATA_SOURCE=fixtures, the global fetch
 * otherwise, decided on every call like the shared Yahoo client.
 */
export function treasuryFetch(input: string, init: RequestInit): Promise<Response> {
  return readEnv().marketDataSource === "fixtures" ? fixtureTreasuryFetch(input, init) : fetch(input, init);
}
