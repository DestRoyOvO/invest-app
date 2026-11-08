// Screener model (EQS): filters over the universe snapshot, presets, column sets, sorting, sharing a screen as URL
// query parameters, CSV export and saved screens. The snapshot is shared by every visitor (lib/server/screener.ts);
// filtering and sorting run in the browser, so changing a filter costs no request.
//
// Everything here is pure except `screensStore`, which touches localStorage only when it is read or written
// (lib/local-store.ts).
//
// Units: filters hold raw values in the snapshot's units (ratios as decimals, percent fields in percent units, dollars).
// Inputs and links use what a person types instead: percents for ratios ("3" for a 3% yield) and billions for dollar
// sizes, so a shared link reads like the form, e.g. /screener?yield=3..&pe=..15.

import { sortRows, type SortDirection, type SortState } from "@/components/ui/table-sort";
import type { ScreenerUniverse, SectorKey } from "@/types/api";
import type { ScreenRow } from "@/types/screener";

import { createLocalStore } from "./local-store";
import { BROAD_ETFS, SECTOR_KEYS, SECTORS, UNIVERSE_STOCKS } from "./universe";

export type { SortDirection, SortState } from "@/components/ui/table-sort";

export const UNIVERSES: readonly ScreenerUniverse[] = ["stocks", "etfs"];

/** Liquid ETFs: the broad market, the SPDR sector funds and the related funds shown on sector pages. */
export const ETF_UNIVERSE: readonly string[] = [...new Set([...BROAD_ETFS, ...SECTORS.flatMap((sector) => [sector.etf, ...sector.relatedEtfs])])];

export function universeSymbols(universe: ScreenerUniverse): readonly string[] {
  return universe === "etfs" ? ETF_UNIVERSE : UNIVERSE_STOCKS;
}

const BOTH = UNIVERSES;
const STOCKS: readonly ScreenerUniverse[] = ["stocks"];
const ETFS: readonly ScreenerUniverse[] = ["etfs"];

// ---------------------------------------------------------------------------
// Metrics: every column, filter and sort key
// ---------------------------------------------------------------------------

/**
 * How a metric's raw value reads: price (dollars), percent (percent units, 1.5 = 1.5%), ratio (decimal shown as a
 * percent), billions (dollars shown in billions), multiple (x), number (beta, RSI, analyst rating), percentile (0-100),
 * date (ISO time, shown as a New York calendar date) and text.
 */
export type MetricUnit = "text" | "price" | "percent" | "ratio" | "billions" | "multiple" | "number" | "percentile" | "date";

interface MetricDef {
  unit: MetricUnit;
  /** Raw value for filtering, sorting and export; null when missing. */
  value: (row: ScreenRow) => number | string | null;
  /** Universes whose rows carry this field. */
  universes: readonly ScreenerUniverse[];
  /** Offered as a min/max filter. */
  range: boolean;
}

export const METRICS = {
  symbol: { unit: "text", value: (r) => r.symbol, universes: BOTH, range: false },
  name: { unit: "text", value: (r) => r.name, universes: BOTH, range: false },
  sector: { unit: "text", value: (r) => r.sector, universes: STOCKS, range: false },
  price: { unit: "price", value: (r) => r.price, universes: BOTH, range: true },
  chg: { unit: "percent", value: (r) => r.changePercent, universes: BOTH, range: true },
  cap: { unit: "billions", value: (r) => r.marketCap, universes: STOCKS, range: true },
  assets: { unit: "billions", value: (r) => r.netAssets, universes: ETFS, range: true },
  er: { unit: "ratio", value: (r) => r.expenseRatio, universes: ETFS, range: true },
  pe: { unit: "multiple", value: (r) => r.trailingPE, universes: BOTH, range: true },
  fpe: { unit: "multiple", value: (r) => r.forwardPE, universes: STOCKS, range: true },
  pb: { unit: "multiple", value: (r) => r.priceToBook, universes: STOCKS, range: true },
  yield: { unit: "ratio", value: (r) => r.dividendYield, universes: BOTH, range: true },
  // Yahoo's fund quotes carry no forward dividend rate or ex-date, so these two are stock columns.
  div: { unit: "price", value: (r) => r.dividendRate ?? null, universes: STOCKS, range: false },
  exdiv: { unit: "date", value: (r) => r.exDividendDate ?? null, universes: STOCKS, range: false },
  rating: { unit: "number", value: (r) => r.analystRating, universes: STOCKS, range: true },
  earnings: { unit: "date", value: (r) => r.nextEarningsDate, universes: STOCKS, range: false },
  ytd: { unit: "percent", value: (r) => r.ytdReturnPercent, universes: ETFS, range: true },
  r1m: { unit: "ratio", value: (r) => r.return1m, universes: BOTH, range: true },
  r3m: { unit: "ratio", value: (r) => r.return3m, universes: BOTH, range: true },
  r6m: { unit: "ratio", value: (r) => r.return6m, universes: BOTH, range: true },
  high: { unit: "ratio", value: (r) => r.fromHigh52, universes: BOTH, range: true },
  ma50: { unit: "ratio", value: (r) => r.vs50d, universes: BOTH, range: false },
  ma200: { unit: "ratio", value: (r) => r.vs200d, universes: BOTH, range: false },
  rsi: { unit: "number", value: (r) => r.rsi14, universes: BOTH, range: true },
  vol: { unit: "ratio", value: (r) => r.factors.volatility, universes: BOTH, range: true },
  beta: { unit: "number", value: (r) => r.factors.beta, universes: BOTH, range: true },
  dvol: { unit: "billions", value: (r) => r.dollarVolume, universes: BOTH, range: true },
  momPct: { unit: "percentile", value: (r) => r.percentiles.momentum, universes: BOTH, range: true },
  revPct: { unit: "percentile", value: (r) => r.percentiles.reversal, universes: BOTH, range: true },
  highPct: { unit: "percentile", value: (r) => r.percentiles.high52, universes: BOTH, range: true },
  volPct: { unit: "percentile", value: (r) => r.percentiles.volatility, universes: BOTH, range: true },
  betaPct: { unit: "percentile", value: (r) => r.percentiles.beta, universes: BOTH, range: true },
} as const satisfies Record<string, MetricDef>;

export type MetricKey = keyof typeof METRICS;

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

/** Metrics offered as min/max filters, in display order. */
export const RANGE_KEYS: readonly MetricKey[] = METRIC_KEYS.filter((key) => METRICS[key].range);

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === "string" && Object.hasOwn(METRICS, value);
}

export function metricUnit(key: MetricKey): MetricUnit {
  return METRICS[key].unit;
}

export function metricValue(key: MetricKey, row: ScreenRow): number | string | null {
  const value = (METRICS[key] as MetricDef).value(row);
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

export function appliesTo(key: MetricKey, universe: ScreenerUniverse): boolean {
  return (METRICS[key].universes as readonly ScreenerUniverse[]).includes(universe);
}

/** Range filters that make sense for the universe. */
export function rangeKeysFor(universe: ScreenerUniverse): MetricKey[] {
  return RANGE_KEYS.filter((key) => appliesTo(key, universe));
}

// ---------------------------------------------------------------------------
// Inputs: what a person types, in percents and billions
// ---------------------------------------------------------------------------

/** Drops binary noise such as 7.000000000000001 from unit conversions. */
function clean(value: number): number {
  return Number(value.toPrecision(12));
}

/** Raw value to the number a person types (percents for ratios, billions for dollar sizes). */
export function toInput(unit: MetricUnit, raw: number): number {
  if (unit === "ratio") return clean(raw * 100);
  if (unit === "billions") return clean(raw / 1e9);
  return raw;
}

/** Typed number back to the raw unit. */
export function fromInput(unit: MetricUnit, input: number): number {
  if (unit === "ratio") return clean(input / 100);
  if (unit === "billions") return clean(input * 1e9);
  return input;
}

export type ParsedInput = { kind: "empty" } | { kind: "number"; value: number } | { kind: "invalid" };

const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Parses a typed bound: "15", "-3.5", "3%", "$1,200", "1.5B", " 2 x ", with a true minus (U+2212) accepted. A unit
 * typed after the number is ignored because the field already says which unit it takes.
 */
export function parseNumberInput(text: string): ParsedInput {
  if (text.trim() === "") return { kind: "empty" };
  const trimmed = text
    .trim()
    .replace(/−/g, "-")
    .replace(/[\s,$]/g, "")
    .replace(/(%|x|bn|b)$/i, "");
  if (!NUMBER_PATTERN.test(trimmed)) return { kind: "invalid" };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { kind: "number", value } : { kind: "invalid" };
}

/** Shortest text for a typed number (no trailing zeros or conversion noise). */
export function formatInputNumber(value: number): string {
  return String(clean(value));
}

// ---------------------------------------------------------------------------
// Filters and screens
// ---------------------------------------------------------------------------

/** Inclusive bounds in the metric's raw unit; null means unbounded on that side. */
export interface NumericRange {
  min: number | null;
  max: number | null;
}

export type Trend = "above" | "below";

/** Rows in the watchlist, in the holdings, in either, or in neither (new ideas). */
export type ListFilter = "watchlist" | "holdings" | "either" | "neither";

export const LIST_FILTERS: readonly ListFilter[] = ["watchlist", "holdings", "either", "neither"];

/** Day windows offered for "earnings within N days". */
export const EARNINGS_WINDOWS = [7, 14, 30] as const;

const MAX_EARNINGS_DAYS = 90;

export interface ScreenFilters {
  /** Empty means every sector. */
  sectors: readonly SectorKey[];
  ranges: Readonly<Partial<Record<MetricKey, NumericRange>>>;
  /** Price above or below its 50- and 200-day averages. */
  ma50: Trend | null;
  ma200: Trend | null;
  /** Next report within this many New York calendar days of the snapshot (0 = the same day). */
  earningsWithinDays: number | null;
  list: ListFilter | null;
}

export const COLUMN_SET_KEYS = ["overview", "valuation", "momentum", "risk", "dividends", "factors"] as const;

export type ColumnSetKey = (typeof COLUMN_SET_KEYS)[number];

/** Everything a shared link or a saved screen restores. */
export interface Screen {
  universe: ScreenerUniverse;
  filters: ScreenFilters;
  columns: ColumnSetKey;
  /** null: the snapshot's own order (by sector, then the universe list). */
  sort: SortState | null;
}

export const EMPTY_FILTERS: ScreenFilters = { sectors: [], ranges: {}, ma50: null, ma200: null, earningsWithinDays: null, list: null };

/** Largest companies or funds first. */
export function defaultSort(universe: ScreenerUniverse): SortState {
  return { key: universe === "etfs" ? "assets" : "cap", direction: "desc" };
}

export function defaultScreen(universe: ScreenerUniverse = "stocks"): Screen {
  return { universe, filters: EMPTY_FILTERS, columns: "overview", sort: defaultSort(universe) };
}

function isBound(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTrend(value: unknown): value is Trend {
  return value === "above" || value === "below";
}

function isListFilter(value: unknown): value is ListFilter {
  return typeof value === "string" && (LIST_FILTERS as readonly string[]).includes(value);
}

export function isColumnSetKey(value: unknown): value is ColumnSetKey {
  return typeof value === "string" && (COLUMN_SET_KEYS as readonly string[]).includes(value);
}

function validDays(value: unknown): number | null {
  return isBound(value) && Number.isInteger(value) && value >= 0 && value <= MAX_EARNINGS_DAYS ? value : null;
}

/**
 * Drops what the universe cannot use (sectors and earnings for ETFs, fund fields for stocks), empty ranges, unknown
 * keys and duplicate sectors, and orders sectors as the universe lists them. Equal filters normalize to equal values.
 */
export function normalizeFilters(filters: ScreenFilters, universe: ScreenerUniverse): ScreenFilters {
  const sectors = universe === "stocks" ? SECTOR_KEYS.filter((key) => filters.sectors.includes(key)) : [];
  const ranges: Partial<Record<MetricKey, NumericRange>> = {};
  for (const key of rangeKeysFor(universe)) {
    const range = filters.ranges[key];
    if (!range) continue;
    const min = isBound(range.min) ? range.min : null;
    const max = isBound(range.max) ? range.max : null;
    if (min !== null || max !== null) ranges[key] = { min, max };
  }
  return {
    sectors,
    ranges,
    ma50: isTrend(filters.ma50) ? filters.ma50 : null,
    ma200: isTrend(filters.ma200) ? filters.ma200 : null,
    earningsWithinDays: universe === "stocks" ? validDays(filters.earningsWithinDays) : null,
    list: isListFilter(filters.list) ? filters.list : null,
  };
}

/** A sort key the universe can sort by, else null. */
function validSort(sort: SortState | null, universe: ScreenerUniverse): SortState | null {
  if (!sort || !isMetricKey(sort.key) || !appliesTo(sort.key, universe)) return null;
  return { key: sort.key, direction: sort.direction === "asc" ? "asc" : "desc" };
}

/** Normalized filters, a known column set and a sort key the universe has (else the default sort). */
export function normalizeScreen(screen: Screen): Screen {
  const universe: ScreenerUniverse = screen.universe === "etfs" ? "etfs" : "stocks";
  return {
    universe,
    filters: normalizeFilters(screen.filters, universe),
    columns: isColumnSetKey(screen.columns) ? screen.columns : "overview",
    sort: screen.sort === null ? null : (validSort(screen.sort, universe) ?? defaultSort(universe)),
  };
}

/** The same screen on the other universe: filters it cannot use are dropped and the sort falls back to the default. */
export function switchUniverse(screen: Screen, universe: ScreenerUniverse): Screen {
  if (screen.universe === universe) return screen;
  const sort = validSort(screen.sort, universe);
  return normalizeScreen({ ...screen, universe, sort: sort ?? defaultSort(universe) });
}

export function filtersEqual(a: ScreenFilters, b: ScreenFilters): boolean {
  if (a.ma50 !== b.ma50 || a.ma200 !== b.ma200 || a.earningsWithinDays !== b.earningsWithinDays || a.list !== b.list) return false;
  if (a.sectors.length !== b.sectors.length || a.sectors.some((key) => !b.sectors.includes(key))) return false;
  const keys = new Set([...Object.keys(a.ranges), ...Object.keys(b.ranges)] as MetricKey[]);
  for (const key of keys) {
    const ra = a.ranges[key];
    const rb = b.ranges[key];
    if ((ra?.min ?? null) !== (rb?.min ?? null) || (ra?.max ?? null) !== (rb?.max ?? null)) return false;
  }
  return true;
}

function hasBound(range: NumericRange | undefined): range is NumericRange {
  return range !== undefined && (range.min !== null || range.max !== null);
}

/** Number of active criteria (a sector set counts once), for the "Filters (3)" badge. */
export function countActiveFilters(filters: ScreenFilters): number {
  return (
    (filters.sectors.length > 0 ? 1 : 0) +
    Object.values(filters.ranges).filter(hasBound).length +
    (filters.ma50 ? 1 : 0) +
    (filters.ma200 ? 1 : 0) +
    (filters.earningsWithinDays !== null ? 1 : 0) +
    (filters.list ? 1 : 0)
  );
}

/** One active criterion, as the removable chips above the results show it. */
export type FilterChip =
  | { id: "sectors"; sectors: readonly SectorKey[] }
  | { id: `range:${MetricKey}`; key: MetricKey; range: NumericRange }
  | { id: "ma50" | "ma200"; trend: Trend }
  | { id: "earnings"; days: number }
  | { id: "list"; list: ListFilter };

export function activeFilterChips(filters: ScreenFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.sectors.length > 0) chips.push({ id: "sectors", sectors: filters.sectors });
  for (const key of RANGE_KEYS) {
    const range = filters.ranges[key];
    if (hasBound(range)) chips.push({ id: `range:${key}`, key, range });
  }
  if (filters.ma50) chips.push({ id: "ma50", trend: filters.ma50 });
  if (filters.ma200) chips.push({ id: "ma200", trend: filters.ma200 });
  if (filters.earningsWithinDays !== null) chips.push({ id: "earnings", days: filters.earningsWithinDays });
  if (filters.list) chips.push({ id: "list", list: filters.list });
  return chips;
}

/** The filters without one criterion (a chip id from activeFilterChips). */
export function removeFilter(filters: ScreenFilters, id: FilterChip["id"]): ScreenFilters {
  if (id === "sectors") return { ...filters, sectors: [] };
  if (id === "ma50" || id === "ma200") return { ...filters, [id]: null };
  if (id === "earnings") return { ...filters, earningsWithinDays: null };
  if (id === "list") return { ...filters, list: null };
  const key = id.slice("range:".length) as MetricKey;
  const ranges = { ...filters.ranges };
  delete ranges[key];
  return { ...filters, ranges };
}

/** The filters with one range replaced (both bounds null removes it). */
export function setRange(filters: ScreenFilters, key: MetricKey, range: NumericRange): ScreenFilters {
  const ranges = { ...filters.ranges };
  if (range.min === null && range.max === null) delete ranges[key];
  else ranges[key] = range;
  return { ...filters, ranges };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-11-07": the New York calendar date of a time. */
export function newYorkDate(ms: number): string {
  return NEW_YORK_DATE.format(new Date(ms));
}

function newYorkDay(ms: number): number {
  const [y, m, d] = newYorkDate(ms).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** New York calendar days from `now` to the time `iso` (0 = the same day, negative = past); null when missing. */
export function daysUntil(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null;
  return newYorkDay(at) - newYorkDay(now);
}

export interface FilterContext {
  watchlist: ReadonlySet<string>;
  holdings: ReadonlySet<string>;
  /** Reference time for "earnings within N days": the snapshot time, so results do not drift with the clock. */
  now: number;
}

function inRange(value: number | string | null, range: NumericRange): boolean {
  if (typeof value !== "number") return false;
  if (range.min !== null && value < range.min) return false;
  if (range.max !== null && value > range.max) return false;
  return true;
}

function matchesTrend(distance: number | null, trend: Trend | null): boolean {
  if (trend === null) return true;
  if (distance === null) return false;
  return trend === "above" ? distance > 0 : distance < 0;
}

function matchesList(symbol: string, list: ListFilter | null, context: FilterContext): boolean {
  if (list === null) return true;
  const inWatchlist = context.watchlist.has(symbol);
  const inHoldings = context.holdings.has(symbol);
  if (list === "watchlist") return inWatchlist;
  if (list === "holdings") return inHoldings;
  if (list === "either") return inWatchlist || inHoldings;
  return !inWatchlist && !inHoldings;
}

/** True when a row passes every active criterion. A missing value fails any criterion on that field. */
export function matchesFilters(row: ScreenRow, filters: ScreenFilters, context: FilterContext): boolean {
  if (filters.sectors.length > 0 && (row.sector === null || !filters.sectors.includes(row.sector))) return false;
  for (const key of Object.keys(filters.ranges) as MetricKey[]) {
    const range = filters.ranges[key];
    if (hasBound(range) && !inRange(metricValue(key, row), range)) return false;
  }
  if (!matchesTrend(row.vs50d, filters.ma50) || !matchesTrend(row.vs200d, filters.ma200)) return false;
  if (filters.earningsWithinDays !== null) {
    const days = daysUntil(row.nextEarningsDate, context.now);
    if (days === null || days < 0 || days > filters.earningsWithinDays) return false;
  }
  return matchesList(row.symbol, filters.list, context);
}

export function filterRows(rows: readonly ScreenRow[], filters: ScreenFilters, context: FilterContext): ScreenRow[] {
  return rows.filter((row) => matchesFilters(row, filters, context));
}

/** Rows per sector in the snapshot, for the counts beside the sector checkboxes. */
export function sectorCounts(rows: readonly ScreenRow[]): Partial<Record<SectorKey, number>> {
  const counts: Partial<Record<SectorKey, number>> = {};
  for (const row of rows) if (row.sector) counts[row.sector] = (counts[row.sector] ?? 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Rows in the screen's order with DataTable's rules (components/ui/table-sort.ts): missing values last in both
 * directions, ties in snapshot order. The table re-sorts by the same values, so the export matches the screen.
 */
export function sortScreenRows(rows: readonly ScreenRow[], sort: SortState | null): ScreenRow[] {
  if (!sort || !isMetricKey(sort.key)) return [...rows];
  const key = sort.key;
  return sortRows(rows, (row) => metricValue(key, row), sort.direction);
}

/** First direction when a column head is clicked: highest first for numbers, A to Z for text, soonest first for dates. */
export function firstSortDirection(key: MetricKey): SortDirection {
  const unit = METRICS[key].unit;
  return unit === "text" || unit === "date" ? "asc" : "desc";
}

// ---------------------------------------------------------------------------
// Column sets
// ---------------------------------------------------------------------------

// Each set fits a 1440px screen with the filter rail open; phones show the symbol and two of the columns.
const MOMENTUM_SET: readonly MetricKey[] = ["symbol", "name", "r1m", "r3m", "r6m", "high", "ma50", "ma200", "rsi"];
const RISK_SET: readonly MetricKey[] = ["symbol", "name", "vol", "volPct", "beta", "betaPct", "high", "dvol"];
const FACTOR_SET: readonly MetricKey[] = ["symbol", "name", "momPct", "revPct", "highPct", "volPct", "betaPct"];

export const COLUMN_SETS: Readonly<Record<ScreenerUniverse, Readonly<Record<ColumnSetKey, readonly MetricKey[]>>>> = {
  stocks: {
    overview: ["symbol", "name", "sector", "price", "chg", "cap", "pe", "earnings"],
    valuation: ["symbol", "name", "cap", "pe", "fpe", "pb", "yield", "rating"],
    momentum: MOMENTUM_SET,
    risk: RISK_SET,
    dividends: ["symbol", "name", "price", "yield", "div", "exdiv", "pe", "cap"],
    factors: FACTOR_SET,
  },
  etfs: {
    overview: ["symbol", "name", "price", "assets", "er", "ytd", "r1m", "r3m", "r6m", "vol", "beta"],
    valuation: ["symbol", "name", "assets", "er", "pe", "yield"],
    momentum: MOMENTUM_SET,
    risk: RISK_SET,
    dividends: ["symbol", "name", "price", "yield", "er", "assets", "ytd"],
    factors: FACTOR_SET,
  },
};

/** The two columns after the symbol that phones keep for each set. */
export const PHONE_COLUMNS: Readonly<Record<ScreenerUniverse, Readonly<Record<ColumnSetKey, readonly [MetricKey, MetricKey]>>>> = {
  stocks: { overview: ["price", "chg"], valuation: ["pe", "yield"], momentum: ["r3m", "high"], risk: ["vol", "beta"], dividends: ["yield", "div"], factors: ["momPct", "volPct"] },
  etfs: { overview: ["price", "ytd"], valuation: ["er", "yield"], momentum: ["r3m", "high"], risk: ["vol", "beta"], dividends: ["yield", "er"], factors: ["momPct", "volPct"] },
};

const NARROW_MOMENTUM: readonly MetricKey[] = ["ma50", "r1m", "rsi", "r6m", "ma200"];
const NARROW_RISK: readonly MetricKey[] = ["dvol", "betaPct", "volPct", "high"];
const NARROW_FACTORS: readonly MetricKey[] = ["revPct", "highPct", "betaPct"];

/**
 * The columns a set gives up, first to last, when the table is narrower than the whole set (a tablet, or a laptop with
 * the filter rail open). The symbol, the name and the two phone columns always stay.
 */
export const NARROW_DROP_ORDER: Readonly<Record<ScreenerUniverse, Readonly<Record<ColumnSetKey, readonly MetricKey[]>>>> = {
  stocks: {
    // Earnings last: the overview is the only set with it, and the "Earnings this week" preset sorts by it.
    overview: ["sector", "pe", "cap", "earnings"],
    valuation: ["fpe", "pb", "rating", "cap"],
    momentum: NARROW_MOMENTUM,
    risk: NARROW_RISK,
    dividends: ["cap", "pe", "price", "exdiv"],
    factors: NARROW_FACTORS,
  },
  etfs: {
    // 1M and 6M first: the momentum set has them, and Vol and Beta are the overview's risk columns.
    overview: ["r1m", "r6m", "assets", "r3m", "vol", "beta", "er"],
    valuation: ["pe", "assets"],
    momentum: NARROW_MOMENTUM,
    risk: NARROW_RISK,
    dividends: ["ytd", "assets", "price"],
    factors: NARROW_FACTORS,
  },
};

export function columnsFor(screen: Pick<Screen, "universe" | "columns">): readonly MetricKey[] {
  return COLUMN_SETS[screen.universe][screen.columns];
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const PRESET_KEYS = ["nearHigh", "dividendValue", "earningsWeek", "lowVol", "above200", "pullback", "analystBuy"] as const;

export type PresetKey = (typeof PRESET_KEYS)[number];

export interface Preset {
  key: PresetKey;
  universes: readonly ScreenerUniverse[];
  filters: ScreenFilters;
  columns: ColumnSetKey;
  sort: SortState;
}

function preset(key: PresetKey, universes: readonly ScreenerUniverse[], filters: Partial<ScreenFilters>, columns: ColumnSetKey, sort: SortState): Preset {
  return { key, universes, filters: { ...EMPTY_FILTERS, ...filters }, columns, sort };
}

export const PRESETS: readonly Preset[] = [
  // Within 3% of the 52-week high.
  preset("nearHigh", BOTH, { ranges: { high: { min: -0.03, max: null } } }, "momentum", { key: "high", direction: "desc" }),
  // A dividend yield of 3% or more and a P/E of 15 or less.
  preset("dividendValue", STOCKS, { ranges: { pe: { min: null, max: 15 }, yield: { min: 0.03, max: null } } }, "dividends", { key: "yield", direction: "desc" }),
  // Next report within 7 days of the snapshot.
  preset("earningsWeek", STOCKS, { earningsWithinDays: 7 }, "overview", { key: "earnings", direction: "asc" }),
  // Volatility percentile of 20 or less within the universe.
  preset("lowVol", BOTH, { ranges: { volPct: { min: null, max: 20 } } }, "risk", { key: "vol", direction: "asc" }),
  preset("above200", BOTH, { ma200: "above" }, "momentum", { key: "ma200", direction: "desc" }),
  // 10 to 20% below the 52-week high.
  preset("pullback", BOTH, { ranges: { high: { min: -0.2, max: -0.1 } } }, "momentum", { key: "high", direction: "asc" }),
  // Mean analyst rating of 2 or better (1 = strong buy, 5 = sell).
  preset("analystBuy", STOCKS, { ranges: { rating: { min: null, max: 2 } } }, "valuation", { key: "rating", direction: "asc" }),
];

export function presetsFor(universe: ScreenerUniverse): Preset[] {
  return PRESETS.filter((p) => p.universes.includes(universe));
}

/** The screen with a preset's filters, column set and sort (the universe stays). */
export function applyPreset(screen: Screen, key: PresetKey): Screen {
  const found = PRESETS.find((p) => p.key === key);
  if (!found || !found.universes.includes(screen.universe)) return screen;
  return normalizeScreen({ ...screen, filters: found.filters, columns: found.columns, sort: found.sort });
}

/** The preset whose filters the screen currently has, if any. */
export function activePreset(screen: Screen): PresetKey | null {
  const filters = normalizeFilters(screen.filters, screen.universe);
  const found = presetsFor(screen.universe).find((p) => filtersEqual(normalizeFilters(p.filters, screen.universe), filters));
  return found?.key ?? null;
}

// ---------------------------------------------------------------------------
// Sharing: URL query parameters
// ---------------------------------------------------------------------------

/** First value of each search parameter from a Next.js page's searchParams. */
export function searchParamsFrom(record: Readonly<Record<string, string | string[] | undefined>>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") params.set(key, first);
  }
  return params;
}

function encodeRange(key: MetricKey, range: NumericRange): string {
  const unit = METRICS[key].unit;
  const side = (value: number | null) => (value === null ? "" : formatInputNumber(toInput(unit, value)));
  return `${side(range.min)}..${side(range.max)}`;
}

function decodeRange(key: MetricKey, text: string): NumericRange | null {
  const parts = text.split("..");
  if (parts.length !== 2) return null;
  const unit = METRICS[key].unit;
  const side = (part: string): number | null | undefined => {
    const parsed = parseNumberInput(part);
    if (parsed.kind === "empty") return null;
    return parsed.kind === "number" ? fromInput(unit, parsed.value) : undefined;
  };
  const min = side(parts[0]);
  const max = side(parts[1]);
  if (min === undefined || max === undefined || (min === null && max === null)) return null;
  return { min, max };
}

/**
 * Query parameters for a screen, with defaults left out so links stay short. Ranges are written in typed units:
 * `yield=3..` is a yield of 3% or more, `cap=10..200` a market cap between $10B and $200B, `high=-20..-10` 10 to 20%
 * below the 52-week high.
 */
export function screenToParams(input: Screen): URLSearchParams {
  const screen = normalizeScreen(input);
  const { filters } = screen;
  const params = new URLSearchParams();
  if (screen.universe === "etfs") params.set("u", "etfs");
  if (filters.sectors.length > 0) params.set("sector", filters.sectors.join(","));
  if (filters.ma50) params.set("ma50", filters.ma50);
  if (filters.ma200) params.set("ma200", filters.ma200);
  if (filters.earningsWithinDays !== null) params.set("earn", String(filters.earningsWithinDays));
  if (filters.list) params.set("list", filters.list);
  for (const key of RANGE_KEYS) {
    const range = filters.ranges[key];
    if (range) params.set(key, encodeRange(key, range));
  }
  if (screen.columns !== "overview") params.set("cols", screen.columns);
  const fallback = defaultSort(screen.universe);
  if (screen.sort === null) params.set("sort", "none");
  else if (screen.sort.key !== fallback.key || screen.sort.direction !== fallback.direction) params.set("sort", `${screen.sort.key}.${screen.sort.direction}`);
  return params;
}

/** "u=etfs&yield=3.." (no leading "?"); empty for the default screen. */
export function screenToQuery(screen: Screen): string {
  return screenToParams(screen).toString();
}

/** The screen a link describes. Unknown parameters and malformed values are ignored, never an error. */
export function screenFromParams(params: URLSearchParams): Screen {
  const universe: ScreenerUniverse = params.get("u") === "etfs" ? "etfs" : "stocks";
  const sectorList = (params.get("sector") ?? "").split(",").map((s) => s.trim());
  const ranges: Partial<Record<MetricKey, NumericRange>> = {};
  for (const key of RANGE_KEYS) {
    const text = params.get(key);
    const range = text === null ? null : decodeRange(key, text);
    if (range) ranges[key] = range;
  }
  const earn = params.get("earn");
  const ma50 = params.get("ma50");
  const ma200 = params.get("ma200");
  const list = params.get("list");
  const filters: ScreenFilters = {
    sectors: SECTOR_KEYS.filter((key) => sectorList.includes(key)),
    ranges,
    ma50: isTrend(ma50) ? ma50 : null,
    ma200: isTrend(ma200) ? ma200 : null,
    earningsWithinDays: earn !== null && /^\d{1,3}$/.test(earn) ? validDays(Number(earn)) : null,
    list: isListFilter(list) ? list : null,
  };
  const cols = params.get("cols");
  const sortText = params.get("sort");
  let sort: SortState | null = defaultSort(universe);
  if (sortText === "none") sort = null;
  else if (sortText) {
    const dot = sortText.lastIndexOf(".");
    const key = sortText.slice(0, dot);
    const direction = sortText.slice(dot + 1);
    if (dot > 0 && isMetricKey(key) && (direction === "asc" || direction === "desc")) sort = { key, direction };
  }
  return normalizeScreen({ universe, filters, columns: isColumnSetKey(cols) ? cols : "overview", sort });
}

// ---------------------------------------------------------------------------
// CSV export (RFC 4180)
// ---------------------------------------------------------------------------

/** Headers stay in English whatever the interface language, so a spreadsheet or a script can rely on them. */
const CSV_HEADERS: Readonly<Record<MetricKey, string>> = {
  symbol: "Symbol",
  name: "Name",
  sector: "Sector",
  price: "Price",
  chg: "Change %",
  cap: "Market cap (USD)",
  assets: "Net assets (USD)",
  er: "Expense ratio %",
  pe: "P/E (TTM)",
  fpe: "Forward P/E",
  pb: "Price/book",
  yield: "Dividend yield %",
  div: "Annual dividend per share",
  exdiv: "Ex-dividend date",
  rating: "Analyst rating (1 strong buy to 5 sell)",
  earnings: "Next earnings date",
  ytd: "YTD return %",
  r1m: "1M return %",
  r3m: "3M return %",
  r6m: "6M return %",
  high: "From 52-week high %",
  ma50: "Vs 50-day average %",
  ma200: "Vs 200-day average %",
  rsi: "RSI (14)",
  vol: "Volatility 63D annualized %",
  beta: "Beta 1Y vs SPY",
  dvol: "Avg daily dollar volume 3M (USD)",
  momPct: "Momentum 12-1 percentile",
  revPct: "1M return percentile",
  highPct: "Close to 52-week high percentile",
  volPct: "Volatility percentile",
  betaPct: "Beta percentile",
};

const CSV_COLUMNS: Readonly<Record<ScreenerUniverse, readonly MetricKey[]>> = {
  stocks: ["symbol", "name", "sector", "price", "chg", "cap", "pe", "fpe", "pb", "yield", "div", "exdiv", "rating", "earnings", "high", "ma50", "ma200", "dvol", "r1m", "r3m", "r6m", "rsi", "vol", "beta", "momPct", "revPct", "highPct", "volPct", "betaPct"],
  etfs: ["symbol", "name", "price", "chg", "assets", "er", "ytd", "pe", "yield", "high", "ma50", "ma200", "dvol", "r1m", "r3m", "r6m", "rsi", "vol", "beta", "momPct", "revPct", "highPct", "volPct", "betaPct"],
};

/** Text that Excel or Sheets would run as a formula gets a leading apostrophe (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One RFC 4180 field: quoted when it holds a comma, a quote or a line break, with quotes doubled. */
export function csvField(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function csvValue(key: MetricKey, row: ScreenRow, sectorLabel: (key: SectorKey) => string): string | number | null {
  const value = metricValue(key, row);
  if (value === null) return null;
  const unit = METRICS[key].unit;
  if (typeof value === "string") {
    if (unit === "date") {
      const at = Date.parse(value);
      return Number.isFinite(at) ? newYorkDate(at) : null;
    }
    const text = key === "sector" ? sectorLabel(value as SectorKey) : value;
    return FORMULA_START.test(text) ? `'${text}` : text;
  }
  if (unit === "ratio") return round(value * 100, 4);
  if (unit === "billions") return Math.round(value);
  if (unit === "percentile") return round(value, 1);
  return round(value, 4);
}

/**
 * The rows as CSV with every field of the universe (not only the visible column set), in the order given, with CRLF
 * line ends. Percent columns are in percent units (3.12 = 3.12%), sizes in dollars, dates as New York YYYY-MM-DD.
 */
export function toCsv(rows: readonly ScreenRow[], universe: ScreenerUniverse, sectorLabel: (key: SectorKey) => string = (key) => key): string {
  const columns = CSV_COLUMNS[universe];
  const lines = [columns.map((key) => csvField(CSV_HEADERS[key])).join(",")];
  for (const row of rows) lines.push(columns.map((key) => csvField(csvValue(key, row, sectorLabel))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** "investseek-screener-stocks-2026-11-07.csv", dated by the snapshot in New York. */
export function csvFileName(universe: ScreenerUniverse, asOf: string | number): string {
  const at = typeof asOf === "number" ? asOf : Date.parse(asOf);
  return `investseek-screener-${universe}-${newYorkDate(Number.isFinite(at) ? at : 0)}.csv`;
}

// ---------------------------------------------------------------------------
// Saved screens (localStorage)
// ---------------------------------------------------------------------------

export const SCREENS_STORAGE_KEY = "investseek:screens:v1";
export const MAX_SAVED_SCREENS = 30;
export const MAX_SCREEN_NAME = 60;
const MAX_QUERY_CHARS = 2000;

/** A named screen. `query` is the share-link query string, so a saved screen is parsed exactly like a link. */
export interface SavedScreen {
  id: string;
  name: string;
  query: string;
  savedAt: string;
}

const NO_SCREENS: readonly SavedScreen[] = [];

export function cleanScreenName(name: unknown): string {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_SCREEN_NAME) : "";
}

function sameName(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/** Turns stored or imported data into a valid list: known shape, normalized queries, unique ids and names, at most 30. */
export function sanitizeSavedScreens(raw: unknown): readonly SavedScreen[] {
  if (!Array.isArray(raw)) return NO_SCREENS;
  const out: SavedScreen[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { id, name, query, savedAt } = item as Record<string, unknown>;
    const cleanName = cleanScreenName(name);
    if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id) || !cleanName || typeof query !== "string" || query.length > MAX_QUERY_CHARS) continue;
    if (out.some((s) => s.id === id || sameName(s.name, cleanName))) continue;
    out.push({
      id,
      name: cleanName,
      query: screenToQuery(screenFromParams(new URLSearchParams(query))),
      savedAt: typeof savedAt === "string" && !Number.isNaN(Date.parse(savedAt)) ? savedAt : new Date(0).toISOString(),
    });
    if (out.length >= MAX_SAVED_SCREENS) break;
  }
  return out;
}

export type SaveScreenResult = "saved" | "updated" | "full" | "invalid";

/**
 * Adds a screen, or replaces the one with the same name (ignoring case) and keeps its id. Newest first. Refuses an
 * empty name, and a new name once 30 screens are saved.
 */
export function upsertSavedScreen(
  list: readonly SavedScreen[],
  entry: { id: string; name: string; screen: Screen; savedAt: string },
): { list: readonly SavedScreen[]; result: SaveScreenResult } {
  const name = cleanScreenName(entry.name);
  if (!name) return { list, result: "invalid" };
  const query = screenToQuery(entry.screen);
  const existing = list.find((s) => sameName(s.name, name));
  if (existing) {
    const updated: SavedScreen = { ...existing, name, query, savedAt: entry.savedAt };
    return { list: [updated, ...list.filter((s) => s.id !== existing.id)], result: "updated" };
  }
  if (list.length >= MAX_SAVED_SCREENS) return { list, result: "full" };
  return { list: [{ id: entry.id, name, query, savedAt: entry.savedAt }, ...list], result: "saved" };
}

export function removeSavedScreen(list: readonly SavedScreen[], id: string): readonly SavedScreen[] {
  return list.filter((s) => s.id !== id);
}

/** Puts a removed screen back at its old position (undo), unless its id or name is taken again meanwhile. */
export function restoreSavedScreen(list: readonly SavedScreen[], entry: SavedScreen, index: number): readonly SavedScreen[] {
  if (list.length >= MAX_SAVED_SCREENS || list.some((s) => s.id === entry.id || sameName(s.name, entry.name))) return list;
  const at = Math.min(Math.max(index, 0), list.length);
  return [...list.slice(0, at), entry, ...list.slice(at)];
}

export const screensStore = createLocalStore<readonly SavedScreen[]>({ key: SCREENS_STORAGE_KEY, sanitize: sanitizeSavedScreens, empty: NO_SCREENS });

// ---------------------------------------------------------------------------
// Discover helpers
// ---------------------------------------------------------------------------

/** Market-cap floors offered on the Discover tab ($300M, $1B, $10B, $100B). */
export const DISCOVER_CAPS = [3e8, 1e9, 1e10, 1e11] as const;
export type DiscoverCap = (typeof DISCOVER_CAPS)[number];
export const DEFAULT_DISCOVER_CAP: DiscoverCap = 1e9;

const CAP_PARAMS: Readonly<Record<DiscoverCap, string>> = { 3e8: "300M", 1e9: "1B", 1e10: "10B", 1e11: "100B" };

/** "300M", "1B", "10B" or "100B". */
export function capParam(cap: DiscoverCap): string {
  return CAP_PARAMS[cap];
}

function findCap(value: string | null | undefined): DiscoverCap | null {
  const wanted = value?.trim().toLowerCase();
  return DISCOVER_CAPS.find((cap) => CAP_PARAMS[cap].toLowerCase() === wanted) ?? null;
}

/** The floor a link value names ("300M", "1B", "10B", "100B"); the default ($1B) for anything else. */
export function parseCapParam(value: string | null | undefined): DiscoverCap {
  return findCap(value) ?? DEFAULT_DISCOVER_CAP;
}

/** Link parameter of the Discover floor. `cap` is the screener's market-cap range, so the floor has a name of its own. */
export const DISCOVER_CAP_PARAM = "mincap";

/**
 * The Discover floor a link names: `mincap`, or `cap` in an older link when it names a floor ("cap=10B"; a range such as
 * "cap=10..200" is a screener filter). The default ($1B) otherwise.
 */
export function discoverCapFromParams(params: URLSearchParams): DiscoverCap {
  const floor = params.get(DISCOVER_CAP_PARAM);
  if (floor !== null) return parseCapParam(floor);
  return findCap(params.get("cap")) ?? DEFAULT_DISCOVER_CAP;
}

export { relativeVolume } from "./volume";

export type RatingKey = "strong_buy" | "buy" | "hold" | "underperform" | "sell";

/** Yahoo's words for a mean rating (1 strong buy ... 5 sell), on the same bands as its "2.3 - Buy" labels. */
export function ratingKey(rating: number | null): RatingKey | null {
  if (rating === null || !Number.isFinite(rating) || rating < 1 || rating > 5) return null;
  if (rating < 1.5) return "strong_buy";
  if (rating < 2.5) return "buy";
  if (rating < 3.5) return "hold";
  if (rating < 4.5) return "underperform";
  return "sell";
}

// ---------------------------------------------------------------------------
// The /screener address: both tabs in one link
// ---------------------------------------------------------------------------

export type ScreenerViewTab = "screener" | "discover";

/** What /screener restores from its address: the tab, the screen and the Discover floor. */
export interface ScreenerViewState {
  tab: ScreenerViewTab;
  screen: Screen;
  cap: DiscoverCap;
}

export function viewFromParams(params: URLSearchParams): ScreenerViewState {
  return { tab: params.get("tab") === "discover" ? "discover" : "screener", screen: screenFromParams(params), cap: discoverCapFromParams(params) };
}

/**
 * The address for what is on screen. Each tab keeps the other's state, so Back or a reload after a visit to Discover
 * still finds the screen: `tab=discover&yield=3..&mincap=10B`. Defaults are left out; the default view is "".
 */
export function viewToQuery(view: ScreenerViewState): string {
  const params = new URLSearchParams();
  if (view.tab === "discover") params.set("tab", "discover");
  for (const [key, value] of screenToParams(view.screen)) params.append(key, value);
  if (view.cap !== DEFAULT_DISCOVER_CAP) params.set(DISCOVER_CAP_PARAM, capParam(view.cap));
  return params.toString();
}
