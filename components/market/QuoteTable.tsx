"use client";

import { useMemo, type ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type Breakpoint, type ContainerBreakpoint, type DataTableColumn, type SortValue } from "@/components/ui/DataTable";
import { Delta, directionOf } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { TickNumber } from "@/components/ui/TickNumber";
import { earningsBadge, formatCompactFixed } from "@/components/watchlist/format";
import { useNow } from "@/hooks/usePortfolio";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatShortDate, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { displayName } from "@/lib/names-zh";
import { formatQuotePrice, priceDigits } from "@/lib/quote-figures";
import type { Lang, Quote } from "@/types/api";

export type QuoteColumn = "name" | "last" | "change" | "changePct" | "volume" | "dollarVolume" | "marketCap" | "pe" | "trend";

/** Fixed widths from the design system; the name column has none, so it takes the rest. */
const WIDTHS: Partial<Record<QuoteColumn, string>> = {
  last: "5.5rem",
  change: "4.5rem",
  changePct: "5rem",
  volume: "5.5rem",
  dollarVolume: "5.5rem",
  marketCap: "5.25rem",
  pe: "3.75rem",
  trend: "6.5rem",
};

/** Phones keep symbol, last, change % and the row actions; the rest needs at least the sm breakpoint. */
const DEFAULT_HIDE: Partial<Record<QuoteColumn, Breakpoint>> = { name: "sm", change: "sm", volume: "sm", marketCap: "sm", pe: "sm", trend: "sm" };

export interface QuoteColumnOptions {
  t: Messages;
  lang: Lang;
  sparklines?: Record<string, number[]>;
  /** Pre-market or after-hours price and change as a second line under last and change %. */
  extendedHours?: boolean;
  /** Earnings badge after the name for reports within 14 days (needs `now`). */
  earnings?: boolean;
  /** Current time from useNow(); 0 hides the earnings badge. */
  now?: number;
  sortable?: boolean;
  /** Breakpoints below which columns hide, overriding the defaults. */
  hide?: Partial<Record<QuoteColumn, Breakpoint | null>>;
  /** Container sizes below which columns hide by the table's own width (in place of the viewport breakpoints). */
  hideContainer?: Partial<Record<QuoteColumn, ContainerBreakpoint>>;
}

/** The second line under last price: "Pre 188.70" / "AH 188.70" (full session name for screen readers). */
function ExtendedPrice({ quote, t, lang }: { quote: Quote | undefined; t: Messages; lang: Lang }) {
  if (!quote?.extendedSession || quote.extendedPrice === null) return <span aria-hidden className="block text-micro leading-4">&nbsp;</span>;
  const pre = quote.extendedSession === "PRE";
  return (
    <span className="block text-micro leading-4 text-fg-3">
      <abbr title={pre ? t.watchlist.preLong : t.watchlist.postLong} className="no-underline">
        {pre ? t.watchlist.pre : t.watchlist.post}
      </abbr>{" "}
      <span className="num text-fg-2">{formatQuotePrice(quote.extendedPrice, digitsOf(quote), lang)}</span>
    </span>
  );
}

function ExtendedChange({ quote }: { quote: Quote | undefined }) {
  if (!quote?.extendedSession || quote.extendedChangePercent === null) return <span aria-hidden className="block text-micro leading-4">&nbsp;</span>;
  return <Delta value={quote.extendedChangePercent} className="block text-micro leading-4" />;
}

/** The decimals of a row's price and change: a currency pair keeps its pips (EURUSD=X 1.1143, USDJPY=X +0.770). */
function digitsOf(quote: Quote | undefined): number | null {
  return quote ? priceDigits(quote.symbol, quote.quoteType) : null;
}

/** "ER 3d" within 14 days (warn color within 7), with the date and whether it is estimated for screen readers. */
export function EarningsBadge({ quote, now, t, lang }: { quote: Quote | undefined; now: number; t: Messages; lang: Lang }) {
  const badge = earningsBadge(quote, now);
  if (!badge) return null;
  const date = formatShortDate(badge.date, lang, "America/New_York");
  const title = tpl(badge.estimated ? t.watchlist.erTitleEst : t.watchlist.erTitle, { date });
  return (
    <span title={title} className={cn(TAG, "shrink-0", badge.warn ? "border-warn/50 text-warn" : "border-line-2 text-fg-2")}>
      <span aria-hidden>{badge.days === 0 ? t.watchlist.erToday : tpl(t.watchlist.er, { n: badge.days })}</span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

/**
 * Small hairline tag after a symbol or name ("POS", "ER 3d"): 11px (the type scale's micro size) semibold, no letter
 * case change. Callers choose whether it may shrink: add shrink-0 to keep it whole.
 */
export const TAG = "inline-flex h-4 items-center rounded-xs border px-1 text-micro leading-none font-semibold whitespace-nowrap";

/**
 * DataTable columns for quote fields. Rows can be anything that yields a quote, so the watchlist (rows with positions
 * and placeholders for quotes still loading) and the plain quote tables share one set of cells.
 */
export function quoteColumns<Row>(columns: readonly QuoteColumn[], quoteOf: (row: Row) => Quote | undefined, options: QuoteColumnOptions): DataTableColumn<Row>[] {
  const { t, lang, sparklines, extendedHours = false, earnings = false, now = 0, sortable = false, hide, hideContainer } = options;
  const hideOf = (col: QuoteColumn) => {
    const override = hide?.[col];
    return override === null ? undefined : (override ?? DEFAULT_HIDE[col]);
  };
  const sort = (value: (q: Quote) => SortValue) =>
    sortable
      ? (row: Row) => {
          const q = quoteOf(row);
          return q ? value(q) : null;
        }
      : undefined;

  const build = (col: QuoteColumn): DataTableColumn<Row> => {
    // Chinese compact numbers run longer ("8882.70亿" for 888.27B), so market cap gets more room.
    const width = col === "marketCap" && lang === "zh" ? "6rem" : WIDTHS[col];
    const base = { key: col, width, hideBelow: hideOf(col), hideBelowContainer: hideContainer?.[col] };
    switch (col) {
      case "name":
        return {
          ...base,
          header: t.columns.name,
          sortValue: sort((q) => displayName(q.symbol, q.name, lang)),
          render: (row) => {
            const q = quoteOf(row);
            return (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-fg-2" title={q?.name}>
                  {(q && displayName(q.symbol, q.name, lang)) ?? ""}
                </span>
                {earnings ? <EarningsBadge quote={q} now={now} t={t} lang={lang} /> : null}
              </span>
            );
          },
        };
      case "last":
        return {
          ...base,
          header: t.columns.last,
          align: "right",
          sortValue: sort((q) => q.price),
          render: (row) => {
            const q = quoteOf(row);
            return (
              <>
                <TickNumber value={q?.price} className="block leading-5 text-fg">
                  {formatQuotePrice(q?.price, digitsOf(q), lang)}
                </TickNumber>
                {extendedHours ? <ExtendedPrice quote={q} t={t} lang={lang} /> : null}
              </>
            );
          },
        };
      case "change":
        return {
          ...base,
          header: t.columns.change,
          align: "right",
          sortValue: sort((q) => q.change),
          render: (row) => {
            const q = quoteOf(row);
            return <Delta value={q?.change} kind="change" digits={digitsOf(q) ?? undefined} lang={lang} />;
          },
        };
      case "changePct":
        return {
          ...base,
          header: t.columns.changePct,
          align: "right",
          sortValue: sort((q) => q.changePercent),
          render: (row) => {
            const q = quoteOf(row);
            return (
              <>
                <Delta value={q?.changePercent} className="block leading-5" />
                {extendedHours ? <ExtendedChange quote={q} /> : null}
              </>
            );
          },
        };
      case "volume":
        return { ...base, header: t.columns.volume, align: "right", sortValue: sort((q) => q.volume), render: (row) => <span className="num text-fg-2">{formatCompactFixed(quoteOf(row)?.volume, lang)}</span> };
      case "dollarVolume":
        return {
          ...base,
          header: t.columns.dollarVolume,
          align: "right",
          sortValue: sort((q) => (q.price !== null && q.volume !== null ? q.price * q.volume : null)),
          render: (row) => {
            const q = quoteOf(row);
            return <span className="num text-fg-2">{formatCompactFixed(q && q.price !== null && q.volume !== null ? q.price * q.volume : null, lang)}</span>;
          },
        };
      case "marketCap":
        return { ...base, header: t.columns.marketCap, align: "right", sortValue: sort((q) => q.marketCap), render: (row) => <span className="num text-fg-2">{formatCompactFixed(quoteOf(row)?.marketCap, lang)}</span> };
      case "pe":
        return {
          ...base,
          header: t.columns.pe,
          align: "right",
          sortValue: sort((q) => q.trailingPE),
          render: (row) => {
            const pe = quoteOf(row)?.trailingPE;
            return <span className="num text-fg-2">{typeof pe === "number" ? pe.toFixed(1) : "—"}</span>;
          },
        };
      case "trend":
        return {
          ...base,
          header: t.columns.trend,
          render: (row) => {
            const q = quoteOf(row);
            return <Sparkline data={(q && sparklines?.[q.symbol]) || []} width={72} height={20} tone={directionOf(q?.changePercent)} className="block" />;
          },
        };
    }
  };
  return columns.map(build);
}

interface QuoteTableProps {
  quotes: Quote[];
  columns: QuoteColumn[];
  sparklines?: Record<string, number[]>;
  /** Trailing actions per row (e.g. a remove button), revealed on hover and keyboard focus, always on touch screens. */
  rowAction?: (quote: Quote) => ReactNode;
  caption?: string;
  dense?: boolean;
  /** Optional: pre-market or after-hours price and change as a second line under last and change %. */
  extendedHours?: boolean;
  /** Optional: an earnings badge after the name for reports within 14 days. */
  earnings?: boolean;
  /** Optional: sortable column heads with aria-sort (the given order otherwise). */
  sortable?: boolean;
  /** Optional: shown when there are no quotes. */
  empty?: ReactNode;
  /** Optional: container sizes below which columns hide by the table's own width, e.g. { trend: "sm" } in a narrow column. */
  hideContainer?: Partial<Record<QuoteColumn, ContainerBreakpoint>>;
}

/**
 * Quote table on DataTable: fixed number widths with a free name column, fixed decimals for compact numbers, ticking
 * prices, and the whole row as a link to the quote page (the symbol is a real link for keyboard and screen readers).
 */
export function QuoteTable({ quotes, columns, sparklines, rowAction, caption, dense = true, extendedHours = false, earnings = false, sortable = false, empty, hideContainer }: QuoteTableProps) {
  const { t, lang } = usePrefs();
  const now = useNow();
  const anyExtended = extendedHours && quotes.some((q) => q.extendedSession !== null && q.extendedPrice !== null);
  const cols = useMemo<DataTableColumn<Quote>[]>(
    () => [
      {
        key: "symbol",
        header: t.columns.symbol,
        width: "5.5rem",
        sortValue: sortable ? (q) => q.symbol : undefined,
        render: (q) => <span className={cn("mono font-medium text-fg", !dense && "inline-flex min-h-10 items-center")}>{q.symbol}</span>,
      },
      ...quoteColumns<Quote>(columns, (q) => q, { t, lang, sparklines, extendedHours: anyExtended, earnings, now, sortable, hideContainer }),
    ],
    [t, lang, columns, sparklines, anyExtended, earnings, now, sortable, dense, hideContainer],
  );
  return (
    <DataTable
      rows={quotes}
      columns={cols}
      rowKey={(q) => q.symbol}
      caption={caption ?? t.columns.symbol}
      rowHref={(q) => stockPath(q.symbol)}
      rowActions={rowAction}
      empty={empty}
    />
  );
}
