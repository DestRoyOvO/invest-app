// Pure formatting and badge rules for the watchlist and positions tables, kept free of React so they can be tested.

import { DASH, formatNumber } from "@/lib/format";
import { calendarDaysUntil } from "@/lib/portfolio";
import type { Lang } from "@/types/api";

const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };
const compactFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Compact large numbers with a fixed number of decimals, so a column reads "3.50T" next to "4.51T" instead of
 * "3.5T". Below 1,000 there is no suffix and whole numbers stay whole.
 */
export function formatCompactFixed(value: number | null | undefined, lang: Lang = "en", digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return DASH;
  if (Math.abs(value) < 1000) return formatNumber(value, Number.isInteger(value) ? 0 : digits, lang);
  const key = `${lang}|${digits}`;
  let formatter = compactFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALES[lang], { notation: "compact", minimumFractionDigits: digits, maximumFractionDigits: digits });
    compactFormatters.set(key, formatter);
  }
  return formatter.format(value);
}

/** Share counts: whole numbers without decimals, fractional shares with up to 4. */
export function formatShares(value: number, lang: Lang = "en"): string {
  if (Number.isInteger(value)) return formatNumber(value, 0, lang);
  const text = formatNumber(value, 4, lang);
  return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Reports this many days ahead or fewer get a badge in the tables. */
export const EARNINGS_BADGE_DAYS = 14;
/** Within this many days the badge uses the warning color. */
export const EARNINGS_WARN_DAYS = 7;

export interface EarningsBadge {
  days: number;
  warn: boolean;
  estimated: boolean;
  date: string;
}

/** The earnings badge for a quote: a report from today to 14 days ahead, warn within 7; null otherwise or without a clock. */
export function earningsBadge(
  quote: { nextEarningsDate: string | null; earningsDateEstimated: boolean | null } | undefined,
  now: number,
): EarningsBadge | null {
  if (!quote?.nextEarningsDate || now <= 0) return null;
  const days = calendarDaysUntil(quote.nextEarningsDate, now);
  if (days === null || days < 0 || days > EARNINGS_BADGE_DAYS) return null;
  return { days, warn: days <= EARNINGS_WARN_DAYS, estimated: quote.earningsDateEstimated === true, date: quote.nextEarningsDate };
}
