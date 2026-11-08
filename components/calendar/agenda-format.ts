// Text for calendar rows and day headings: time slots, ET times, macro titles, money at stake. Pure, so the copy rules
// (ET times, the viewer's clock only when it differs, true minus signs) are tested in agenda-format.test.ts.

import { localTimeOf, nyClock, relativeDay, reportTimeKnown, type AgendaInput, type AgendaItem } from "@/lib/events";
import { formatNumber, tpl } from "@/lib/format";
import { DEFAULT_CURRENCY } from "@/lib/portfolio";
import type { Messages } from "@/lib/i18n/messages";
import type { Lang } from "@/types/api";

import type { SurpriseEntry } from "./earnings-model";

const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };

type CalendarText = Messages["calendar"];

/** The time column: a session slot for reports, the ET time for macro releases, "Ex-date" for dividends. */
export function timeLabel(item: AgendaItem, t: CalendarText): string {
  const { event } = item;
  if (event.kind === "dividend") return t.exDate;
  if (event.kind === "earnings") {
    if (event.estimated) return t.slot.tbd;
    if (event.timing) return t.slot[event.timing];
    return item.minute !== null ? tpl(t.timeEt, { time: nyClock(Date.parse(event.at)) }) : t.slot.tbd;
  }
  return tpl(t.timeEt, { time: nyClock(Date.parse(event.at)) });
}

/** "HH:MM ET" of a confirmed report when Yahoo gives its release time (see reportTimeKnown); null otherwise. */
export function reportTimeEt(symbol: string, iso: string, t: CalendarText): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !reportTimeKnown(symbol, iso)) return null;
  return tpl(t.timeEt, { time: nyClock(ms) });
}

/** The viewer's clock for a timed event when it differs from New York, e.g. "03:00 +1 day"; null otherwise. */
export function localLabel(item: AgendaItem, timeZone: string | null, t: CalendarText): string | null {
  if (!timeZone || item.minute === null) return null;
  const local = localTimeOf(Date.parse(item.event.at), timeZone);
  if (!local) return null;
  if (local.dayOffset > 0) return `${local.time} ${t.nextDay}`;
  if (local.dayOffset < 0) return `${local.time} ${t.prevDay}`;
  return local.time;
}

/** Day heading such as "Mon, Nov 9" / "11月9日周一". */
export function dayHeading(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** Short weekday of a day key, e.g. "Mon" / "周一". */
export function dayShort(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** "Today", "Tomorrow", "In 3 days"; empty beyond a week, where the date says enough. */
export function relativeLabel(day: string, today: string, t: CalendarText): string {
  const relative = relativeDay(day, today);
  if (relative.kind === "today") return t.days.today;
  if (relative.kind === "tomorrow") return t.days.tomorrow;
  if (relative.kind === "yesterday") return t.days.yesterday;
  if (relative.kind === "weekday") return tpl(t.days.inDays, { n: relative.offset });
  return "";
}

/** Reference month of a macro release ("2026-10") as "October" / "10月". */
export function periodMonthName(period: string, lang: Lang): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15));
  return new Intl.DateTimeFormat(LOCALES[lang], { month: lang === "zh" ? "short" : "long", timeZone: "UTC" }).format(date);
}

/** Second part of a macro row: "for October" or "with projections". */
export function macroDetail(item: AgendaItem, t: CalendarText, lang: Lang): string | null {
  const { event } = item;
  if (event.kind !== "macro") return null;
  if (event.macro === "fomc") return event.projections ? t.projections : null;
  return event.period ? tpl(t.forMonth, { month: periodMonthName(event.period, lang) }) : null;
}

/** A position or cash amount: no decimals from 1,000 up, the currency code when it is not US dollars. */
export function formatMoney(value: number, currency: string | null, lang: Lang, cents = false): string {
  const digits = cents || Math.abs(value) < 1000 ? 2 : 0;
  const text = formatNumber(value, digits, lang);
  return currency && currency !== "USD" ? `${currency} ${text}` : text;
}

/** A dividend per share with two to four decimals: 0.27, 0.235, 1.50. */
export function formatDividend(amount: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount);
}

/** "+", "−" or "=" for a surprise mark. */
export function markGlyph(entry: SurpriseEntry): string {
  return entry.mark === "beat" ? "+" : entry.mark === "miss" ? "−" : "=";
}

/** Spoken summary of the marks, e.g. "Last 4 reports vs the estimate: beat, beat, missed, in line". */
export function marksLabel(entries: readonly SurpriseEntry[], t: CalendarText): string {
  if (entries.length === 0) return t.surprises.none;
  const words = entries.map((e) => (e.mark === "beat" ? t.surprises.beat : e.mark === "miss" ? t.surprises.miss : t.surprises.inline));
  return tpl(t.surprises.label, { n: entries.length, list: words.join(", ") });
}

export interface Amount {
  value: number;
  /** Quote currency; null when unknown (a position valued at cost before its quote arrived). */
  currency: string | null;
}

/**
 * Totals per currency, never converted: the currency with the most amounts first, US dollars on a tie, then by name
 * (the lib/portfolio.ts base-currency rules). An unknown currency counts as US dollars.
 */
export function totalsByCurrency(amounts: readonly Amount[]): Amount[] {
  const totals = new Map<string, { value: number; count: number }>();
  for (const amount of amounts) {
    const currency = amount.currency ?? DEFAULT_CURRENCY;
    const entry = totals.get(currency) ?? { value: 0, count: 0 };
    totals.set(currency, { value: entry.value + amount.value, count: entry.count + 1 });
  }
  return [...totals.entries()]
    .sort((a, b) => b[1].count - a[1].count || Number(b[0] === DEFAULT_CURRENCY) - Number(a[0] === DEFAULT_CURRENCY) || a[0].localeCompare(b[0]))
    .map(([currency, { value }]) => ({ value, currency }));
}

/** Value of every position (last price, or average cost while no price is known, as on the agenda rows) per currency. */
export function portfolioTotals(input: AgendaInput): Amount[] {
  const amounts: Amount[] = [];
  for (const [symbol, holding] of Object.entries(input.holdings)) {
    const quote = input.prices?.get(symbol);
    const price = quote?.price ?? null;
    const priced = price !== null && Number.isFinite(price) && price > 0;
    amounts.push({ value: holding.shares * (priced ? price : holding.cost), currency: quote?.currency ?? null });
  }
  return totalsByCurrency(amounts);
}

/** `part` as a share of `whole`, only when both are in one and the same currency (amounts are never converted). */
export function shareOfPositions(part: readonly Amount[], whole: readonly Amount[]): number | null {
  if (part.length !== 1 || whole.length !== 1 || part[0].currency !== whole[0].currency || !(whole[0].value > 0)) return null;
  return part[0].value / whole[0].value;
}

export interface Glance {
  /** Held symbols with a report in the period. */
  reporting: string[];
  /** Value of those positions per currency, the largest group first. */
  reportingValues: Amount[];
  /** Watchlist symbols (not held) with a report. */
  watchReporting: string[];
  /** Approximate dividend cash for holders per currency, the largest group first. */
  dividendCash: Amount[];
  exDividend: string[];
  macro: AgendaItem[];
}

/** Figures for the "At a glance" tiles from the period's events (before the group filters). */
export function glance(items: readonly AgendaItem[]): Glance {
  const reporting = new Map<string, Amount | null>();
  const watch = new Set<string>();
  const cash: Amount[] = [];
  const exDividend = new Set<string>();
  const macro: AgendaItem[] = [];
  for (const item of items) {
    const { event } = item;
    if (event.kind === "macro") macro.push(item);
    else if (event.symbol && event.kind === "earnings") {
      if (item.shares !== null) reporting.set(event.symbol, item.positionValue === null ? null : { value: item.positionValue, currency: item.currency });
      else if (item.filters.includes("watchlist")) watch.add(event.symbol);
    } else if (event.symbol && event.kind === "dividend" && item.shares !== null) {
      exDividend.add(event.symbol);
      if (item.dividendCash !== null) cash.push({ value: item.dividendCash, currency: item.currency });
    }
  }
  const values = [...reporting.values()].filter((v): v is Amount => v !== null);
  return {
    reporting: [...reporting.keys()],
    reportingValues: totalsByCurrency(values),
    watchReporting: [...watch],
    dividendCash: totalsByCurrency(cash),
    exDividend: [...exDividend],
    macro,
  };
}
