// Text for screener cells and filter chips, kept free of React so it can be tested. Numbers follow the design system:
// tabular figures, a true minus (U+2212) and "—" for missing values. Colors are decided by the components.

import { withTrueMinus } from "@/components/ui/delta-utils";
import { DASH, formatCompact, formatNumber, formatPrice, formatRatio, formatShortDate, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { daysUntil, formatInputNumber, metricUnit, toInput, type FilterChip, type MetricKey, type NumericRange } from "@/lib/screens";
import type { Lang, SectorKey } from "@/types/api";

const NEW_YORK = "America/New_York";

/** Metrics whose sign is shown (+/−) because they measure a distance from a reference level. */
const SIGNED: ReadonlySet<MetricKey> = new Set(["high", "ma50", "ma200"]);

/**
 * Neutral text for a metric value in a table cell: dollars, percents, compact sizes and plain numbers, negatives with a
 * true minus (a negative beta, P/E or price to book). Returns, P&L and prices that tick are rendered by Delta and
 * TickNumber instead; this covers everything else.
 */
export function formatMetric(key: MetricKey, value: number | string | null, lang: Lang): string {
  if (value === null || value === undefined) return DASH;
  if (typeof value === "string") return key === "exdiv" || key === "earnings" ? formatShortDate(value, lang, NEW_YORK) : value;
  return withTrueMinus(numberText(key, value, lang));
}

function numberText(key: MetricKey, value: number, lang: Lang): string {
  switch (metricUnit(key)) {
    case "price":
      return formatPrice(value, lang);
    case "percent":
      return formatNumber(value, 2, lang) + "%";
    case "ratio":
      if (key === "er" || key === "yield") return formatRatio(value, { digits: 2 });
      return formatRatio(value, { digits: 1, sign: SIGNED.has(key) });
    case "billions":
      return formatCompact(value, lang);
    case "multiple":
      return formatNumber(value, 1, lang);
    case "percentile":
      return String(Math.round(value));
    case "number":
      return key === "rsi" ? formatNumber(value, 0, lang) : formatNumber(value, key === "rating" ? 1 : 2, lang);
    default:
      return String(value);
  }
}

/** A bound as a person typed it, with its unit: "3%", "$10B", "$25", "15", "−20%". */
export function formatBound(key: MetricKey, raw: number): string {
  const unit = metricUnit(key);
  const text = withTrueMinus(formatInputNumber(toInput(unit, raw)));
  if (unit === "ratio" || unit === "percent") return `${text}%`;
  if (unit === "billions") return `$${text}B`;
  if (unit === "price") return `$${text}`;
  return text;
}

export function rangeLabel(t: Messages, key: MetricKey, range: NumericRange): string {
  const metric = t.screener.metricNames[key];
  if (range.min !== null && range.max !== null) {
    return tpl(t.screener.filters.rangeBetween, { metric, min: formatBound(key, range.min), max: formatBound(key, range.max) });
  }
  if (range.min !== null) return tpl(t.screener.filters.rangeMin, { metric, min: formatBound(key, range.min) });
  return tpl(t.screener.filters.rangeMax, { metric, max: formatBound(key, range.max ?? 0) });
}

/** The words on an active-filter chip. */
export function chipLabel(t: Messages, chip: FilterChip, sectorLabel: (key: SectorKey) => string): string {
  switch (chip.id) {
    case "sectors": {
      const names = chip.sectors.map(sectorLabel);
      const list = names.length <= 2 ? names.join(", ") : tpl(t.screener.filters.sectorMore, { first: names[0], n: names.length - 1 });
      return tpl(t.screener.filters.sectorChip, { list });
    }
    case "ma50":
    case "ma200":
      return t.screener.filters.trendChip[chip.id][chip.trend];
    case "earnings":
      return tpl(t.screener.filters.earningsChip, { n: chip.days });
    case "list":
      return t.screener.filters.listOptions[chip.list];
    default:
      return rangeLabel(t, chip.key, chip.range);
  }
}

export interface EarningsText {
  /** Visible cell text: "Today", "5d", "~5d"; a dash when unknown or past. */
  short: string;
  /** Spoken text: "in 5 days, estimated". */
  long: string | null;
  /** Hover text: the date, plus "estimated". */
  title: string | null;
}

/** Days to the next report relative to the snapshot time, with "~" for a date the company has not confirmed. */
export function earningsText(t: Messages, iso: string | null, estimated: boolean | null, now: number, lang: Lang): EarningsText {
  const days = daysUntil(iso, now);
  if (days === null || days < 0 || iso === null) return { short: DASH, long: null, title: null };
  const mark = estimated ? "~" : "";
  const short = days === 0 ? t.screener.earningsToday : `${mark}${tpl(t.screener.earningsDays, { n: days })}`;
  const spoken = days === 0 ? t.screener.earningsTodayLong : tpl(t.screener.earningsIn, { n: days });
  const date = formatShortDate(iso, lang, NEW_YORK);
  return {
    short,
    long: estimated ? `${spoken}, ${t.screener.estimated}` : spoken,
    title: estimated ? `${date} (${t.screener.estimated})` : date,
  };
}

/** Relative volume as "2.4x". */
export function formatRelativeVolume(value: number | null, lang: Lang): string {
  return value === null ? DASH : `${formatNumber(value, value < 10 ? 1 : 0, lang)}x`;
}
