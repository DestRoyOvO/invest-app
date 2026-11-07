// Pure view helpers for the earnings and analyst panels and the calendar rows: surprise marks, estimate changes, the
// "Into the report" note, rating bars and the price-target scale. No React; tested in earnings-model.test.ts.

import { daysBetween, eventDayKey, nyDayKey } from "@/lib/events";
import { formatCompact, formatNumber, formatPrice, formatRatio, tpl } from "@/lib/format";
import type { Lang } from "@/types/api";
import type { EarningsDetail, EarningsEstimate, EarningsQuarter, ImpliedMove, RatingCounts } from "@/types/earnings";

const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };

/** True for a known quote type other than a stock (ETF, INDEX, CRYPTOCURRENCY, ...): no earnings or analyst coverage. */
export function isNonEquity(quoteType: string | null | undefined): boolean {
  return typeof quoteType === "string" && quoteType !== "EQUITY";
}

/** Surprises within half a percent count as in line. */
export const INLINE_BAND = 0.005;

export type SurpriseMark = "beat" | "miss" | "inline";

export function surpriseMark(surprise: number | null | undefined): SurpriseMark | null {
  if (surprise === null || surprise === undefined || !Number.isFinite(surprise)) return null;
  if (Math.abs(surprise) < INLINE_BAND) return "inline";
  return surprise > 0 ? "beat" : "miss";
}

export interface SurpriseEntry {
  period: string;
  surprise: number;
  mark: SurpriseMark;
}

/** The last `n` quarters with a surprise, oldest first. */
export function lastSurprises(history: readonly EarningsQuarter[], n = 4): SurpriseEntry[] {
  return history
    .filter((q): q is EarningsQuarter & { surprise: number } => q.surprise !== null && Number.isFinite(q.surprise))
    .slice(-n)
    .map((q) => ({ period: q.period, surprise: q.surprise, mark: surpriseMark(q.surprise)! }));
}

/** Change from `then` to `now` relative to |then| (EPS can be negative); null without both or when then is 0. */
export function relativeChange(now: number | null, then: number | null): number | null {
  if (now === null || then === null || then === 0 || !Number.isFinite(now) || !Number.isFinite(then)) return null;
  return (now - then) / Math.abs(then);
}

/** The quarterly estimate behind the next report: the one the consensus names, else the earliest upcoming quarter. */
export function upcomingQuarter(detail: EarningsDetail): EarningsEstimate | null {
  const quarters = detail.estimates.filter((e) => e.period === "0q" || e.period === "+1q");
  const named = detail.consensus?.periodEnd ? quarters.find((e) => e.periodEnd === detail.consensus?.periodEnd) : undefined;
  if (named) return named;
  const lastEnd = detail.history.at(-1)?.periodEnd ?? null;
  return (
    quarters
      .filter((e) => e.periodEnd !== null && (lastEnd === null || e.periodEnd > lastEnd))
      .sort((a, b) => (a.periodEnd ?? "").localeCompare(b.periodEnd ?? ""))[0] ?? null
  );
}

export interface TrendPoint {
  key: "now" | "d7" | "d30" | "d90";
  days: number;
  value: number | null;
  /** Change from this point to now (relative); null for "now". */
  changeToNow: number | null;
}

/** The EPS estimate now and 7, 30 and 90 days ago, with the change since each. */
export function estimateTrend(estimate: EarningsEstimate): TrendPoint[] {
  const now = estimate.epsTrend.current ?? estimate.epsAvg;
  const points: Array<[TrendPoint["key"], number, number | null]> = [
    ["now", 0, now],
    ["d7", 7, estimate.epsTrend.d7],
    ["d30", 30, estimate.epsTrend.d30],
    ["d90", 90, estimate.epsTrend.d90],
  ];
  return points.map(([key, days, value]) => ({ key, days, value, changeToNow: key === "now" ? null : relativeChange(now, value) }));
}

/** True when the date is today or within `days` days ahead (New York calendar days). */
export function withinDays(iso: string | null, now: number, days: number): boolean {
  if (!iso) return false;
  const ahead = daysBetween(nyDayKey(now), eventDayKey(iso));
  return ahead >= 0 && ahead <= days;
}

/** Calendar days from today (New York) to the date: 0 today, negative in the past; null without a date. */
export function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const day = eventDayKey(iso);
  return day ? daysBetween(nyDayKey(now), day) : null;
}

/** Signed percent for neutral text, e.g. "+5.6%" or "−2.1%" (true minus). */
export function signedPercent(ratio: number | null, digits = 1): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  const text = `${Math.abs(ratio * 100).toFixed(digits)}%`;
  // A change that rounds to zero prints without a sign, never as "−0.0%".
  if (Number(text.slice(0, -1)) === 0) return text;
  return ratio > 0 ? `+${text}` : `−${text}`;
}

/** Short date of an exchange date, e.g. "Nov 17" / "11月17日". */
export function shortDay(iso: string, lang: Lang): string {
  const day = eventDayKey(iso);
  if (!day) return "—";
  return new Intl.DateTimeFormat(LOCALES[lang], { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** Weekday and date of an exchange date, e.g. "Tue, Nov 17" / "11月17日周二". */
export function weekdayDay(iso: string, lang: Lang): string {
  const day = eventDayKey(iso);
  if (!day) return "—";
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

export interface NoteLabels {
  when: { today: string; tomorrow: string; inDays: string; daysAgo: string };
  slot: { pre: string; post: string; intraday: string; tbd: string };
  note: {
    reports: string;
    reportsTbd: string;
    consensus: string;
    consensusPlain: string;
    revenue: string;
    rose: string;
    fell: string;
    flat: string;
    revisions: string;
    beats: string;
    implied: string;
  };
}

/** "today", "tomorrow", "in 5 days" in the sentence's case (lower-cased in English). */
export function relativeWhen(days: number, labels: NoteLabels["when"], lang: Lang, sentence = false): string {
  const text = days === 0 ? labels.today : days === 1 ? labels.tomorrow : days > 1 ? tpl(labels.inDays, { n: days }) : tpl(labels.daysAgo, { n: -days });
  return sentence && lang === "en" ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * The deterministic "Into the report" note shown within 14 days of a report: when, consensus, how the estimate moved,
 * the beat record and the implied move. Facts only, one sentence each; empty without a next report date.
 */
export function intoReportNote(detail: EarningsDetail, implied: ImpliedMove | null, now: number, labels: NoteLabels, lang: Lang): string[] {
  if (!detail.nextDate) return [];
  const days = daysUntil(detail.nextDate, now) ?? 0;
  const when = relativeWhen(days, labels.when, lang, true);
  const date = weekdayDay(detail.nextDate, lang);
  const sentences: string[] = [];
  if (detail.nextDateEstimated || !detail.nextTiming) {
    sentences.push(tpl(labels.note.reportsTbd, { when, date }));
  } else {
    const slot = labels.slot[detail.nextTiming];
    sentences.push(tpl(labels.note.reports, { when, date, slot: lang === "en" ? slot.toLowerCase() : slot }));
  }

  const consensus = detail.consensus;
  if (consensus?.epsAvg !== null && consensus?.epsAvg !== undefined) {
    const eps = formatNumber(consensus.epsAvg, 2, lang);
    if (consensus.analysts && consensus.epsLow !== null && consensus.epsHigh !== null) {
      sentences.push(tpl(labels.note.consensus, { eps, n: consensus.analysts, low: formatNumber(consensus.epsLow, 2, lang), high: formatNumber(consensus.epsHigh, 2, lang) }));
    } else {
      sentences.push(tpl(labels.note.consensusPlain, { eps }));
    }
    if (consensus.revenueAvg !== null) sentences.push(tpl(labels.note.revenue, { revenue: formatCompact(consensus.revenueAvg, lang) }));
  }

  const quarter = upcomingQuarter(detail);
  if (quarter) {
    const change = relativeChange(quarter.epsTrend.current ?? quarter.epsAvg, quarter.epsTrend.d90);
    if (change !== null) {
      if (Math.abs(change) < 0.0005) sentences.push(labels.note.flat);
      else sentences.push(tpl(change > 0 ? labels.note.rose : labels.note.fell, { pct: formatRatio(Math.abs(change), { digits: 1 }) }));
    }
    const { up30, down30 } = quarter.revisions;
    if (up30 !== null && down30 !== null && up30 + down30 > 0) sentences.push(tpl(labels.note.revisions, { up: up30, down: down30 }));
  }

  const surprises = lastSurprises(detail.history, 4);
  if (surprises.length > 0) {
    sentences.push(tpl(labels.note.beats, { k: surprises.filter((s) => s.mark === "beat").length, n: surprises.length }));
  }

  if (implied) sentences.push(tpl(labels.note.implied, { pct: formatRatio(implied.move, { digits: 1 }), date: shortDay(implied.expiry, lang) }));
  return sentences;
}

export const RATING_KEYS = ["strongBuy", "buy", "hold", "sell", "strongSell"] as const;
export type RatingKey = (typeof RATING_KEYS)[number];

export function ratingTotal(row: RatingCounts): number {
  return RATING_KEYS.reduce((sum, key) => sum + row[key], 0);
}

/** Each rating's count and share of the month's total (shares are 0 for an empty month). */
export function ratingSegments(row: RatingCounts): Array<{ key: RatingKey; count: number; share: number }> {
  const total = ratingTotal(row);
  return RATING_KEYS.map((key) => ({ key, count: row[key], share: total > 0 ? row[key] / total : 0 }));
}

/** Month a recommendationTrend period refers to ("0m" this month, "-1m" last month), as a short month name. */
export function periodMonth(period: string, now: number, lang: Lang): string {
  const back = /^-?(\d+)m$/.exec(period);
  const offset = back ? Number(back[1]) : 0;
  const [y, m] = nyDayKey(now).split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALES[lang], { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1 - offset, 1)));
}

export interface TargetScale {
  min: number;
  max: number;
}

/** A scale that holds the target range and the price with some room on both sides; null without a valid range. */
export function targetScale(low: number | null, high: number | null, price: number | null): TargetScale | null {
  if (low === null || high === null || !(high > low) || low <= 0) return null;
  const lo = price !== null && price > 0 ? Math.min(low, price) : low;
  const hi = price !== null && price > 0 ? Math.max(high, price) : high;
  const pad = (hi - lo) * 0.04;
  return { min: lo - pad, max: hi + pad };
}

/** Position of a value on the scale, 0 to 100. */
export function scalePosition(scale: TargetScale, value: number): number {
  return Math.min(100, Math.max(0, ((value - scale.min) / (scale.max - scale.min)) * 100));
}

/**
 * Price formatting for targets: whole numbers from 1,000 up, else two decimals. `compact` (the actions table) also drops
 * the decimals from 100 up, where analysts quote round targets anyway.
 */
export function formatTarget(value: number | null, lang: Lang, compact = false): string {
  if (value === null) return "—";
  return Math.abs(value) >= (compact ? 100 : 1000) ? formatNumber(value, 0, lang) : formatPrice(value, lang);
}
