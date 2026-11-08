// The headline figures of the investor's day, shared by the watchlist band, My day and the portfolio page. Pure, so the
// rules behind them (a value-weighted day %, extended hours kept apart, which session the day figure covers) are tested.

import type { Messages } from "@/lib/i18n/messages";
import { dayChangeRatio, extendedHoursPnl, lastSessionDate, type ExtendedHoursPnl, type Portfolio } from "@/lib/portfolio";
import type { Lang, Quote } from "@/types/api";

export interface DayFigures {
  currency: string;
  value: number;
  dayPnl: number;
  /** Value-weighted: dayPnl / (value - dayPnl). */
  dayRatio: number | null;
  pnl: number;
  pnlPct: number | null;
  costBasis: number;
  positions: number;
  /** Pre-market or after-hours P&L, never part of dayPnl. */
  extended: ExtendedHoursPnl | null;
  /** New York date (UTC midnight) of the session the day P&L covers when it was before today; null for today. */
  sessionDate: number | null;
}

/** The headline figures of the base-currency positions; `now` (useNow) tells today's session from an earlier one. */
export function dayFigures(portfolio: Portfolio, quotes: ReadonlyMap<string, Quote>, now: number): DayFigures {
  const { totals, rows, baseCurrency } = portfolio;
  const quoteOf = (symbol: string) => quotes.get(symbol);
  return {
    currency: baseCurrency,
    value: totals.value,
    dayPnl: totals.dayPnl,
    dayRatio: dayChangeRatio(rows),
    pnl: totals.pnl,
    pnlPct: totals.pnlPct,
    costBasis: totals.costBasis,
    positions: rows.length,
    extended: extendedHoursPnl(rows, quoteOf),
    sessionDate: lastSessionDate(rows, quoteOf, now),
  };
}

export function extendedLabel(session: ExtendedHoursPnl["session"], t: Messages): string {
  return session === "PRE" ? t.watchlist.preMarketPnl : session === "POST" ? t.watchlist.afterHoursPnl : t.watchlist.extendedPnl;
}

/** How many tiles DayTiles renders, so the parent grid can size its columns without empty cells. */
export function dayTileCount(figures: DayFigures, costBasis: boolean): number {
  return 3 + (costBasis ? 1 : 0) + (figures.extended ? 1 : 0);
}

/** "Today" while the day P&L is today's; "Last session" when the market has not traded today (weekend, before the open). */
export function dayLabel(figures: DayFigures, t: Messages): string {
  return figures.sessionDate === null ? t.watchlist.today : t.watchlist.lastSession;
}

const sessionFormatters = new Map<Lang, Intl.DateTimeFormat>();

/** The session a day figure covers, with its weekday: "Fri, Nov 6" / "11月6日周五". */
export function formatSessionDate(date: number, lang: Lang): string {
  let formatter = sessionFormatters.get(lang);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    sessionFormatters.set(lang, formatter);
  }
  return formatter.format(new Date(date));
}
