// Text for research statistics (rank ICs, t statistics, p-values, shares) as the quant panels and the factor lab print
// them. Negative numbers use the true minus (U+2212), which is as wide as "+" in tabular figures. Pure, so it is tested.

import { DASH } from "@/lib/format";
import type { Lang } from "@/types/api";

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** "2016-2026" from two ISO dates, or one year when both fall in it. */
export function yearSpan(from: string, to: string): string {
  const a = from.slice(0, 4);
  const b = to.slice(0, 4);
  return a === b ? a : `${a}-${b}`;
}

/** Fixed decimals with a sign: "+0.015", "−0.010". A value that rounds to zero prints unsigned ("0.000"). */
export function signedFixed(value: number | null | undefined, digits: number): string {
  if (!isNum(value)) return DASH;
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return fixed;
  return value > 0 ? `+${fixed}` : `\u2212${fixed}`;
}

/** A rank IC: three decimals with a sign, e.g. "−0.010". */
export function formatIc(value: number | null | undefined): string {
  return signedFixed(value, 3);
}

/** A t statistic: a true minus for negatives and no plus sign, e.g. "−1.06" or "0.62". */
export function formatT(value: number | null | undefined, digits = 2): string {
  if (!isNum(value)) return DASH;
  const fixed = Math.abs(value).toFixed(digits);
  return value < 0 && Number(fixed) !== 0 ? `\u2212${fixed}` : fixed;
}

/** A p-value: "<0.001", three decimals below 0.1 ("0.063"), two above ("0.42", "1.00"). */
export function formatP(p: number | null | undefined): string {
  if (!isNum(p)) return DASH;
  if (p < 0.001) return "<0.001";
  if (p < 0.1) return p.toFixed(3);
  return p.toFixed(2);
}

/**
 * A ratio as a percentage with a true minus, e.g. pct(-0.0123, 2, true) is "−1.23%". A value that rounds to zero
 * prints unsigned ("0.00%"), so a tiny negative never shows as "−0.00%".
 */
export function pct(value: number | null | undefined, digits = 1, sign = false): string {
  if (!isNum(value)) return DASH;
  const fixed = Math.abs(value * 100).toFixed(digits);
  const prefix = Number(fixed) === 0 ? "" : value < 0 ? "\u2212" : sign ? "+" : "";
  return `${prefix}${fixed}%`;
}

/** An English ordinal for percentiles ("1st", "22nd", "73rd", "11th"); Chinese copy uses the plain number. */
export function ordinal(n: number, lang: Lang): string {
  const k = Math.round(n);
  if (lang === "zh") return String(k);
  const lastTwo = Math.abs(k) % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${k}th`;
  switch (Math.abs(k) % 10) {
    case 1:
      return `${k}st`;
    case 2:
      return `${k}nd`;
    case 3:
      return `${k}rd`;
    default:
      return `${k}th`;
  }
}

/** A beta with two decimals and a true minus, e.g. "1.89" or "−0.61". */
export function formatBeta(value: number | null | undefined): string {
  return formatT(value, 2);
}

/** A correlation-like reading with two decimals and no sign for positives, e.g. "0.72". */
export function formatCorrelation(value: number | null | undefined): string {
  return formatT(value, 2);
}

/** Joins words as a list in the reader’s language: "A, B and C" in English, "A、B和C" in Chinese. */
export function joinList(items: readonly string[], lang: Lang): string {
  return new Intl.ListFormat(lang === "zh" ? "zh-CN" : "en-US", { style: "long", type: "conjunction" }).format(items);
}

/** Joins a series of values without a conjunction: "18%, 22%, 25%" in English, "18%、22%、25%" in Chinese. */
export function joinValues(items: readonly string[], lang: Lang): string {
  return new Intl.ListFormat(lang === "zh" ? "zh-CN" : "en-US", { style: "narrow", type: "conjunction" }).format(items);
}

/** A blend weight as written in a formula: up to two decimals, no trailing zeros ("0.5", "0.35"). */
export function formatWeight(value: number): string {
  return String(Math.round(value * 100) / 100);
}
