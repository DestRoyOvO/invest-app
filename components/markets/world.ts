// Pure helpers behind the world markets page: grouping the board by region, session words, the exchange-local time of
// the last trade and the overnight summary line.

import type { Lang, MarketState } from "@/types/api";
import type { WorldRow } from "@/types/markets";
import { WORLD_BOARD, WORLD_REGIONS, type WorldRegion, type WorldSymbol } from "@/lib/universe";

export type SessionKind = "open" | "pre" | "post" | "closed" | "unknown";

/** Yahoo's market state as one of four session words. */
export function sessionOf(state: MarketState | null): SessionKind {
  switch (state) {
    case "REGULAR":
      return "open";
    case "PRE":
    case "PREPRE":
      return "pre";
    case "POST":
    case "POSTPOST":
      return "post";
    case "CLOSED":
      return "closed";
    default:
      return "unknown";
  }
}

export interface WorldEntry {
  def: WorldSymbol;
  /** Null when the instrument had no quote (it failed upstream). */
  row: WorldRow | null;
}

/** Every WORLD_BOARD instrument grouped by region, in WORLD_REGIONS order, with its row when one arrived. */
export function groupWorld(rows: readonly WorldRow[]): Array<{ region: WorldRegion; entries: WorldEntry[] }> {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  return WORLD_REGIONS.map((region) => ({
    region,
    entries: WORLD_BOARD.filter((def) => def.region === region).map((def) => ({ def, row: bySymbol.get(def.symbol) ?? null })),
  }));
}

const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };

/** YYYY-MM-DD of an instant on the clock of a time zone. */
export function dateInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

/**
 * When the last trade happened, on the exchange's own clock: "15:30" when that was today in the exchange's time zone,
 * otherwise with the weekday ("Fri 15:30", "周五 15:30"). A dash without a time.
 */
export function localTradeTime(iso: string | null, timeZone: string, lang: Lang, now: number = Date.now()): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return "—";
  const time = new Intl.DateTimeFormat(LOCALES[lang], { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
  if (dateInZone(ms, timeZone) === dateInZone(now, timeZone)) return time;
  const weekday = new Intl.DateTimeFormat(LOCALES[lang], { timeZone, weekday: "short" }).format(ms);
  return `${weekday} ${time}`;
}

export interface OvernightItem {
  symbol: string;
  code: string;
  changePercent: number | null;
}

export interface OvernightGroup {
  region: "asia" | "europe";
  /** True while any of the region's benchmarks trades; otherwise the line shows the last close. */
  live: boolean;
  items: OvernightItem[];
}

/** The Asian and European benchmarks of the overnight line (WORLD_BOARD's `overnight` flag), skipping missing quotes. */
export function overnightSummary(rows: readonly WorldRow[]): OvernightGroup[] {
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  return (["asia", "europe"] as const).flatMap((region) => {
    const present = WORLD_BOARD.filter((def) => def.region === region && def.overnight).flatMap((def) => {
      const row = bySymbol.get(def.symbol);
      return row ? [{ def, row }] : [];
    });
    if (present.length === 0) return [];
    return [
      {
        region,
        live: present.some(({ row }) => sessionOf(row.marketState) === "open"),
        items: present.map(({ def, row }) => ({ symbol: def.symbol, code: def.code, changePercent: row.changePercent })),
      },
    ];
  });
}

/** True while an exchange-traded instrument (anything but crypto, which never closes) is in its regular session. */
export function anyExchangeOpen(rows: readonly WorldRow[]): boolean {
  const regions = new Map(WORLD_BOARD.map((def) => [def.symbol, def.region]));
  return rows.some((row) => regions.get(row.symbol) !== "crypto" && sessionOf(row.marketState) === "open");
}
