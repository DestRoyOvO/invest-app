import "server-only";

import type { SpreadKey, TenorKey, YieldCurve, YieldCurveResponse, YieldSpread } from "@/types/markets";

import { cached, HOUR, isFresh, MINUTE, put } from "./cache";
import { treasuryFetch } from "./fixtures/treasury";
import { logThrottled } from "./log";

// The US Treasury daily par yield curve (GC): Treasury publishes one CSV per calendar year on home.treasury.gov, with
// no key. This module downloads the current and the previous year on the server (the browser's CSP allows only this
// origin), parses them defensively, caches each year for 6 hours (served stale for up to 48 hours when a download
// fails) and derives today's curve, the curves a month and a year earlier, and the 2s10s and 3m10y spreads.

/** Tenors in maturity order with their length in months. "6W" is the 1.5-month bill Treasury added in 2025. */
export const TENORS: ReadonlyArray<{ key: TenorKey; months: number }> = [
  { key: "1M", months: 1 },
  { key: "6W", months: 1.5 },
  { key: "2M", months: 2 },
  { key: "3M", months: 3 },
  { key: "4M", months: 4 },
  { key: "6M", months: 6 },
  { key: "1Y", months: 12 },
  { key: "2Y", months: 24 },
  { key: "3Y", months: 36 },
  { key: "5Y", months: 60 },
  { key: "7Y", months: 84 },
  { key: "10Y", months: 120 },
  { key: "20Y", months: 240 },
  { key: "30Y", months: 360 },
];

const TENOR_BY_MONTHS = new Map<number, TenorKey>(TENORS.map((tenor) => [tenor.months, tenor.key]));

const SPREADS: ReadonlyArray<{ key: SpreadKey; long: TenorKey; short: TenorKey }> = [
  { key: "2s10s", long: "10Y", short: "2Y" },
  { key: "3m10y", long: "10Y", short: "3M" },
];

export const RATES_TTL_MS = 6 * HOUR;
const RATES_STALE_MS = 48 * HOUR;
/** A year Treasury has not published yet (the first business days of January) is checked again after an hour. */
export const EMPTY_YEAR_TTL_MS = HOUR;
const FETCH_TIMEOUT_MS = 10_000;
/** A year of daily rows is about 20 KB; anything far larger is not the file we asked for. */
const MAX_CSV_BYTES = 512 * 1024;
/** Cells outside this range (percent) are treated as missing rather than plotted. */
const MIN_YIELD = -5;
const MAX_YIELD = 30;

export interface YieldObservation {
  /** YYYY-MM-DD. */
  date: string;
  /** Percent; tenors Treasury left blank that day are absent. */
  yields: Partial<Record<TenorKey, number>>;
}

/** The file did not look like Treasury's yield curve CSV (no Date column or no tenor columns). */
export class TreasuryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreasuryFormatError";
  }
}

export function treasuryCsvUrl(year: number): string {
  return (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/" +
    `${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`
  );
}

/** Splits one CSV line into trimmed fields; double quotes group a field and "" inside quotes is a literal quote. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      fields.push(field.trim());
      field = "";
    } else field += char;
  }
  fields.push(field.trim());
  return fields;
}

/** Length in months of a tenor column header: "1 Mo" is 1, "1.5 Month" is 1.5, "10 Yr" is 120. Null for other headers. */
export function headerMonths(header: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(mos?|months?|yrs?|years?)\.?$/i.exec(header.replace(/\s+/g, " ").trim());
  if (!match) return null;
  const count = Number(match[1]);
  return match[2].toLowerCase().startsWith("y") ? count * 12 : count;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "11/06/2026" or "2026-11-06" as "2026-11-06"; null for anything else, including dates that do not exist. */
export function parseTreasuryDate(text: string): string | null {
  const value = text.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  let parts: [number, number, number];
  if (us) parts = [Number(us[3]), Number(us[1]), Number(us[2])];
  else if (iso) parts = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseYield(cell: string | undefined): number | null {
  const value = cell?.trim() ?? "";
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null; // blank, "N/A", "ND"
  const yieldPercent = Number(value);
  return yieldPercent >= MIN_YIELD && yieldPercent <= MAX_YIELD ? yieldPercent : null;
}

/**
 * Parses one year of Treasury's daily par yield curve CSV. Columns are matched by header, because tenors have been
 * added over the years and the order is not guaranteed; unknown columns are ignored, blank or non-numeric cells are
 * missing values, and rows without a valid date or without any yield are skipped. Observations come back sorted by
 * date, one per date. Throws TreasuryFormatError when the header is not the yield curve's.
 */
export function parseTreasuryCsv(text: string): YieldObservation[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new TreasuryFormatError("Treasury CSV is empty");
  const header = splitCsvLine(lines[0]);
  const dateColumn = header.findIndex((name) => name.toLowerCase() === "date");
  const columns = header.flatMap((name, index) => {
    const months = headerMonths(name);
    const key = months === null ? undefined : TENOR_BY_MONTHS.get(months);
    return key ? [{ index, key }] : [];
  });
  if (dateColumn < 0 || columns.length === 0) throw new TreasuryFormatError("Treasury CSV has no Date or tenor columns");

  const byDate = new Map<string, YieldObservation>();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const date = parseTreasuryDate(cells[dateColumn] ?? "");
    if (!date) continue;
    const yields: Partial<Record<TenorKey, number>> = {};
    let found = false;
    for (const { index, key } of columns) {
      const value = parseYield(cells[index]);
      if (value === null) continue;
      yields[key] = value;
      found = true;
    }
    if (found) byDate.set(date, { date, yields });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Observations of several files merged by date (later files win on the same date), sorted by date. */
export function mergeObservations(lists: ReadonlyArray<readonly YieldObservation[]>): YieldObservation[] {
  const byDate = new Map<string, YieldObservation>();
  for (const list of lists) for (const observation of list) byDate.set(observation.date, observation);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** A YYYY-MM-DD date moved back by whole months, with the day clamped to the month's length (Mar 31 less 1 month is Feb 28). */
export function monthsBefore(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const index = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${pad2(targetMonth + 1)}-${pad2(Math.min(day, lastDay))}`;
}

/** The latest observation on or before the date, from observations sorted by date. */
export function observationOnOrBefore(observations: readonly YieldObservation[], date: string): YieldObservation | null {
  for (let i = observations.length - 1; i >= 0; i -= 1) {
    if (observations[i].date <= date) return observations[i];
  }
  return null;
}

/** long minus short in basis points, to one decimal; null when either yield is missing. */
export function spreadBp(observation: YieldObservation, long: TenorKey, short: TenorKey): number | null {
  const a = observation.yields[long];
  const b = observation.yields[short];
  return a === undefined || b === undefined ? null : Math.round((a - b) * 1000) / 10;
}

function curveOf(observation: YieldObservation, tenors: readonly TenorKey[]): YieldCurve {
  return { date: observation.date, yields: tenors.map((key) => observation.yields[key] ?? null) };
}

export interface CurveMeta {
  /** The latest download failed and older data is shown. */
  stale?: boolean;
  /** When the file behind the latest observation was downloaded (defaults to `now`). */
  fetchedAt?: Date;
  warnings?: string[];
  now?: Date;
}

/**
 * The curve response from observations sorted by date: the latest curve with a 10-year yield, the latest curves on or
 * before one month and one year earlier, and the spreads over the last year. Null without a usable observation.
 */
export function buildYieldCurve(observations: readonly YieldObservation[], meta: CurveMeta = {}): YieldCurveResponse | null {
  const { stale = false, now = new Date(), fetchedAt = now, warnings = [] } = meta;
  const withTenYear = observations.filter((observation) => observation.yields["10Y"] !== undefined);
  const latest = withTenYear[withTenYear.length - 1];
  if (!latest) return null;
  const monthAgo = observationOnOrBefore(observations, monthsBefore(latest.date, 1));
  const yearAgo = observationOnOrBefore(observations, monthsBefore(latest.date, 12));
  const curves = [latest, monthAgo, yearAgo].filter((curve): curve is YieldObservation => curve !== null);
  const tenors = TENORS.map((tenor) => tenor.key).filter((key) => curves.some((curve) => curve.yields[key] !== undefined));

  const historyFrom = monthsBefore(latest.date, 12);
  const window = observations.filter((observation) => observation.date > historyFrom && observation.date <= latest.date);
  const spreads: YieldSpread[] = SPREADS.map(({ key, long, short }) => {
    const history = window.flatMap((observation) => {
      const bp = spreadBp(observation, long, short);
      return bp === null ? [] : [{ date: observation.date, bp }];
    });
    return {
      key,
      bp: spreadBp(latest, long, short),
      monthAgoBp: monthAgo ? spreadBp(monthAgo, long, short) : null,
      history,
      invertedDays: history.filter((point) => point.bp < 0).length,
    };
  });

  return {
    asOf: now.toISOString(),
    tenors,
    current: curveOf(latest, tenors),
    monthAgo: monthAgo ? curveOf(monthAgo, tenors) : null,
    yearAgo: yearAgo ? curveOf(yearAgo, tenors) : null,
    spreads,
    stale,
    fetchedAt: fetchedAt.toISOString(),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Download and cache
// ---------------------------------------------------------------------------

export type TreasuryFetch = (url: string, init: RequestInit) => Promise<Response>;

interface YearData {
  observations: YieldObservation[];
  fetchedAt: number;
}

async function downloadYear(year: number, fetchImpl: TreasuryFetch): Promise<YieldObservation[]> {
  const response = await fetchImpl(treasuryCsvUrl(year), {
    headers: { accept: "text/csv" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Treasury CSV ${year} answered HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_CSV_BYTES) throw new Error(`Treasury CSV ${year} is too large`);
  const text = await response.text();
  if (text.length > MAX_CSV_BYTES) throw new Error(`Treasury CSV ${year} is too large`);
  // A year Treasury has not published yet (January 1 until its first release) comes back as an empty 200 response:
  // that is a year without observations, not a broken download.
  if (text.trim() === "") return [];
  return parseTreasuryCsv(text);
}

function yearKey(year: number): string {
  return `rates:treasury:${year}`;
}

async function loadYear(year: number, fetchImpl: TreasuryFetch): Promise<YearData> {
  const load = { downloaded: false };
  const data = await cached(yearKey(year), { ttlMs: RATES_TTL_MS, staleMs: RATES_STALE_MS }, async () => {
    try {
      const observations = await downloadYear(year, fetchImpl);
      load.downloaded = true;
      return { observations, fetchedAt: Date.now() };
    } catch (error) {
      logThrottled(`rates.download.${year}`, 10 * MINUTE, "warn", "rates.download_failed", { year, error });
      throw error;
    }
  });
  // An empty year is kept for an hour only, so the first curve of the year shows up soon after Treasury publishes it.
  if (load.downloaded && data.observations.length === 0) put(yearKey(year), data, { ttlMs: EMPTY_YEAR_TTL_MS, staleMs: RATES_STALE_MS });
  return data;
}

/** The calendar year in New York, where Treasury publishes. */
export function treasuryYear(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(now));
}

/**
 * The yield curve from this year's and last year's files. A failed download falls back to the cached copy (up to 48
 * hours old) and marks the response stale; without the current year the curve comes from last year alone, and without
 * last year it says so in `warnings`. A year Treasury has not published yet is simply empty. Throws when neither year
 * can be loaded.
 */
export async function getYieldCurve(options: { now?: Date; fetchImpl?: TreasuryFetch } = {}): Promise<YieldCurveResponse> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? treasuryFetch;
  const year = treasuryYear(now);
  const [current, previous] = await Promise.allSettled([loadYear(year, fetchImpl), loadYear(year - 1, fetchImpl)]);
  const loaded = [previous, current].flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (loaded.length === 0) throw current.status === "rejected" ? current.reason : new Error("Treasury yield curve unavailable");

  const stale = current.status === "rejected" || Date.now() - current.value.fetchedAt > RATES_TTL_MS;
  // The latest curve comes from the newest file with observations; its download time is the age of what is shown.
  const newest = [current, previous].find(
    (result): result is PromiseFulfilledResult<YearData> => result.status === "fulfilled" && result.value.observations.length > 0,
  );
  const curve = buildYieldCurve(mergeObservations(loaded.map((data) => data.observations)), {
    stale,
    now,
    fetchedAt: new Date(newest ? newest.value.fetchedAt : Date.now()),
    warnings: previous.status === "rejected" ? ["previous_year"] : [],
  });
  if (!curve) throw new Error("Treasury yield curve has no observations");
  return curve;
}

/** Downloads a request for the curve would start now: one per year whose cached file expired. */
export function uncachedRatesCalls(now: Date = new Date()): number {
  const year = treasuryYear(now);
  return [year, year - 1].filter((y) => !isFresh(yearKey(y))).length;
}
