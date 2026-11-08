// Locale-aware number and date formatting for the UI.
// Inputs follow types/api.ts: percent fields are in percent units, ratio fields are decimals, missing values are null.

import type { Lang } from "@/types/api";

export const DASH = "—";

const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };

const formatterCache = new Map<string, Intl.NumberFormat>();

function numberFormat(lang: Lang, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALES[lang], options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Sign of the raw value. For a direction color, arrow or sign next to a printed number, use displayedSign. */
export function signOf(value: number | null | undefined): -1 | 0 | 1 {
  if (!isNum(value) || value === 0) return 0;
  return value > 0 ? 1 : -1;
}

/**
 * Sign of a value as printed with `digits` decimals: 0 when it rounds to zero there (−0.004 at two decimals prints
 * "0.00", never "−0.00"), for −0 and for a missing or non-finite value. Signs, direction colors and arrows next to a
 * formatted change, percent or P&L follow it, so a move that prints as zero is flat everywhere.
 */
export function displayedSign(value: number | null | undefined, digits: number): -1 | 0 | 1 {
  if (!isNum(value) || Number(Math.abs(value).toFixed(digits)) === 0) return 0;
  return value > 0 ? 1 : -1;
}

/** Plain number with fixed decimals and grouping, e.g. 7,376.86. A negative value that rounds to zero prints "0.00". */
export function formatNumber(value: number | null | undefined, digits = 2, lang: Lang = "en"): string {
  if (!isNum(value)) return DASH;
  // Intl writes a negative value that rounds to zero, and −0 itself, as "-0.00".
  const shown = displayedSign(value, digits) === 0 ? 0 : value;
  return numberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(shown);
}

/** A signed number with fixed decimals and grouping, e.g. +1.80 or -0.770; one that rounds to zero prints unsigned (0.00). */
export function formatSigned(value: number | null | undefined, digits: number, lang: Lang = "en"): string {
  if (!isNum(value)) return DASH;
  const sign = displayedSign(value, digits);
  const text = formatNumber(Math.abs(value), digits, lang);
  return sign > 0 ? `+${text}` : sign < 0 ? `-${text}` : text;
}

/** Price with sensible precision: 2 decimals, 4 below 1, none above 100k (e.g. index levels stay at 2). */
export function formatPrice(value: number | null | undefined, lang: Lang = "en"): string {
  if (!isNum(value)) return DASH;
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return formatNumber(value, digits, lang);
}

/**
 * Decimals formatChange prints a change with: 4 for a sub-cent move that still shows at four decimals, 2 otherwise (a
 * move that rounds to zero even at four decimals is no move, and prints as 0.00 like zero itself).
 */
export function changeDigits(value: number | null | undefined): number {
  if (!isNum(value)) return 2;
  const abs = Math.abs(value);
  return abs < 0.01 && displayedSign(abs, 4) !== 0 ? 4 : 2;
}

/** Signed absolute change, e.g. +1.80 or -12.34 (4 decimals only for sub-cent moves); 0.00 when it rounds to zero. */
export function formatChange(value: number | null | undefined, lang: Lang = "en"): string {
  return formatSigned(value, changeDigits(value), lang);
}

/** Percent from percent units, e.g. 1.234 -> "+1.23%"; a value that rounds to zero prints unsigned ("0.00%"). */
export function formatPercent(value: number | null | undefined, options: { digits?: number; sign?: boolean } = {}): string {
  if (!isNum(value)) return DASH;
  const digits = options.digits ?? 2;
  const shown = displayedSign(value, digits);
  const prefix = shown < 0 ? "-" : shown > 0 && (options.sign ?? true) ? "+" : "";
  return `${prefix}${Math.abs(value).toFixed(digits)}%`;
}

/** Percent from a decimal ratio, e.g. 0.2534 -> "25.3%". */
export function formatRatio(value: number | null | undefined, options: { digits?: number; sign?: boolean } = {}): string {
  if (!isNum(value)) return DASH;
  return formatPercent(value * 100, { digits: options.digits ?? 1, sign: options.sign ?? false });
}

/** Multiple, e.g. 38.1x. */
export function formatMultiple(value: number | null | undefined, digits = 1): string {
  if (!isNum(value)) return DASH;
  return `${value.toFixed(digits)}x`;
}

/** Compact large numbers: en "4.98T", zh "4.98万亿". */
export function formatCompact(value: number | null | undefined, lang: Lang = "en", digits = 2): string {
  if (!isNum(value)) return DASH;
  return numberFormat(lang, { notation: "compact", maximumFractionDigits: digits }).format(value);
}

/** Integer with grouping, e.g. 43,750,861. A negative value that rounds to zero prints "0". */
export function formatInteger(value: number | null | undefined, lang: Lang = "en"): string {
  if (!isNum(value)) return DASH;
  return numberFormat(lang, { maximumFractionDigits: 0 }).format(displayedSign(value, 0) === 0 ? 0 : value);
}

function toDate(iso: string | number | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date such as "Nov 6, 2026" / "2026年11月6日". Exchange dates should pass timeZone "America/New_York". */
export function formatDate(iso: string | number | null | undefined, lang: Lang = "en", timeZone?: string): string {
  const date = toDate(iso);
  if (!date) return DASH;
  return new Intl.DateTimeFormat(LOCALES[lang], { year: "numeric", month: "short", day: "numeric", timeZone }).format(date);
}

/** Short date such as "Nov 6" / "11月6日". */
export function formatShortDate(iso: string | number | null | undefined, lang: Lang = "en", timeZone?: string): string {
  const date = toDate(iso);
  if (!date) return DASH;
  return new Intl.DateTimeFormat(LOCALES[lang], { month: "short", day: "numeric", timeZone }).format(date);
}

/** 24-hour time such as "16:00". */
export function formatTime(iso: string | number | null | undefined, lang: Lang = "en", timeZone?: string, seconds = false): string {
  const date = toDate(iso);
  if (!date) return DASH;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: false,
    timeZone,
  }).format(date);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["minute", 60],
  ["hour", 3600],
  ["day", 86400],
];

/** "5 min. ago" / "5分钟前"; older than a week falls back to a short date. */
export function formatRelativeTime(iso: string | null | undefined, lang: Lang = "en", now: number = Date.now()): string {
  const date = toDate(iso);
  if (!date) return DASH;
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return lang === "zh" ? "刚刚" : "just now";
  if (abs >= 7 * 86400) return formatShortDate(date.getTime(), lang);
  const rtf = new Intl.RelativeTimeFormat(LOCALES[lang], { numeric: "auto", style: "short" });
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let size = 60;
  for (const [u, s] of RELATIVE_UNITS) {
    if (abs >= s) {
      unit = u;
      size = s;
    }
  }
  return rtf.format(Math.round(seconds / size), unit);
}

/** Replaces {name} placeholders in a message template. */
export function tpl(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
