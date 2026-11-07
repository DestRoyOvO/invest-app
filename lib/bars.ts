// Daily bar normalization shared by the server data layer and offline scripts (pure, no I/O).

/** Daily bar with the dividend/split-adjusted close, used by the signal engine. */
export interface DailyBar {
  /** UTC midnight of the session date in the exchange time zone. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  adjClose: number;
  v: number | null;
}

/** Loose shape of a yahoo-finance2 chart() result (validation is off, so every field is checked here). */
export interface RawChart {
  meta?: Record<string, unknown>;
  quotes?: Array<Record<string, unknown>>;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Converts chart rows into clean daily bars: drops rows with missing or non-positive prices, maps each row to the
 * session date in the exchange time zone (UTC midnight), and keeps only the latest row when Yahoo repeats a date.
 */
export function normalizeBars(chart: RawChart | null | undefined): DailyBar[] {
  if (!chart?.quotes) return [];
  const gmtOffsetSec = finite(chart.meta?.gmtoffset) ?? 0;
  const bars: DailyBar[] = [];
  for (const q of chart.quotes) {
    const date = q.date instanceof Date ? q.date : typeof q.date === "string" ? new Date(q.date) : null;
    const o = finite(q.open);
    const h = finite(q.high);
    const l = finite(q.low);
    const c = finite(q.close);
    if (!date || Number.isNaN(date.getTime()) || o === null || h === null || l === null || c === null || c <= 0) continue;
    const local = new Date(date.getTime() + gmtOffsetSec * 1000);
    const t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    const adjClose = finite(q.adjclose) ?? c;
    const v = finite(q.volume);
    if (bars.length > 0 && bars[bars.length - 1].t === t) bars.pop();
    bars.push({ t, o, h, l, c, adjClose, v });
  }
  return bars;
}
