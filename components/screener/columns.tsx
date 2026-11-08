"use client";

import Link from "next/link";

import { Checkbox } from "@/components/ui/Checkbox";
import type { DataTableColumn } from "@/components/ui/DataTable";
import { Delta } from "@/components/ui/Delta";
import { Meter } from "@/components/ui/Meter";
import { TickNumber } from "@/components/ui/TickNumber";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { DASH, formatPrice, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { firstSortDirection, metricUnit, metricValue, PHONE_COLUMNS, ratingKey, type ColumnSetKey, type MetricKey } from "@/lib/screens";
import { getSector } from "@/lib/universe";
import type { Lang, ScreenerUniverse } from "@/types/api";
import type { ScreenRow } from "@/types/screener";

import { earningsText, formatMetric } from "./display";
import { WatchStar } from "./WatchStar";
import { SELECT_REM, STAR_REM, WIDTHS } from "./widths";

/**
 * Narrower columns below sm, set on the table: the checkbox and star cells drop their padding there and hold a 40px
 * control, and factor columns cap at 6rem with a shorter meter, so the symbol and two columns fit a 360px screen.
 */
export const PHONE_WIDTHS = "max-sm:[--eqs-select:2.5rem] max-sm:[--eqs-star:2.5rem] max-sm:[--eqs-pct-max:6rem]";

/** Returns and today's change are price moves, so they take the up and down colors; every other number is neutral. */
const PRICE_MOVES: ReadonlySet<MetricKey> = new Set(["chg", "ytd", "r1m", "r3m", "r6m"]);

export interface ScreenColumnContext {
  t: Messages;
  lang: Lang;
  universe: ScreenerUniverse;
  set: ColumnSetKey;
  /** The snapshot time: "earnings in N days" counts from here. */
  now: number;
  watchlist: ReadonlySet<string>;
  onToggleWatch: (symbol: string) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (symbol: string) => void;
  /** Header checkbox state over the visible rows. */
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
  visibleCount: number;
}

const missing = <span className="text-fg-3">{DASH}</span>;

function MetricCell({ metric, row, context }: { metric: MetricKey; row: ScreenRow; context: ScreenColumnContext }) {
  const { t, lang } = context;
  const value = metricValue(metric, row);
  if (metric === "symbol") {
    return (
      <Link href={stockPath(row.symbol)} data-row-link className="mono font-medium text-fg hover:text-accent focus-visible:outline-offset-[-2px]" title={row.name}>
        {row.symbol}
      </Link>
    );
  }
  if (metric === "name") {
    return (
      <span className="text-fg-2" title={row.name}>
        {row.name}
      </span>
    );
  }
  if (metric === "sector") {
    const sector = row.sector ? getSector(row.sector) : undefined;
    return sector ? (
      <span className="text-fg-2" title={sector.label[lang]}>
        {sector.short[lang]}
      </span>
    ) : (
      missing
    );
  }
  if (value === null) return missing;
  if (metric === "price") return <TickNumber value={row.price}>{formatPrice(row.price, lang)}</TickNumber>;
  if (PRICE_MOVES.has(metric) && typeof value === "number") {
    return metricUnit(metric) === "ratio" ? <Delta value={value} kind="ratio" digits={1} /> : <Delta value={value} />;
  }
  if (metric === "earnings") {
    const text = earningsText(t, row.nextEarningsDate, row.earningsDateEstimated, context.now, lang);
    if (!text.long) return missing;
    return (
      <span className="num text-fg" title={text.title ?? undefined}>
        <span aria-hidden>{text.short}</span>
        <span className="sr-only">{text.long}</span>
      </span>
    );
  }
  if (metric === "rating" && typeof value === "number") {
    const key = ratingKey(value);
    return (
      <span title={t.screener.metricNames.rating}>
        <span className="num text-fg">{formatMetric("rating", value, lang)}</span>
        {key ? <span className="ml-1.5 text-fg-3">{t.stock.recommendation[key]}</span> : null}
      </span>
    );
  }
  if (metricUnit(metric) === "percentile" && typeof value === "number") {
    return (
      <span className="flex items-center justify-end gap-2">
        <Meter
          value={value}
          label={t.screener.metricNames[metric]}
          valueText={tpl(t.screener.percentile, { n: Math.round(value) })}
          className="w-12 max-sm:w-8 max-sm:min-w-8"
        />
        <span aria-hidden className="num w-7 text-right text-fg">
          {Math.round(value)}
        </span>
      </span>
    );
  }
  return <span className="num text-fg">{formatMetric(metric, value, lang)}</span>;
}

function metricColumn(metric: MetricKey, context: ScreenColumnContext): DataTableColumn<ScreenRow> {
  const width = WIDTHS[metric];
  const phone = metric === "symbol" || PHONE_COLUMNS[context.universe][context.set].includes(metric);
  const numeric = metric !== "symbol" && metric !== "name" && metric !== "sector";
  return {
    key: metric,
    header: context.t.screener.metrics[metric],
    // Touch screens never show a title, so the column-set row also shows the ~ note while the column is on screen.
    title: metric === "earnings" ? `${context.t.screener.metricNames.earnings}. ${context.t.screener.estimatedNote}` : context.t.screener.metricNames[metric],
    align: numeric ? "right" : "left",
    width: width === null ? undefined : metricUnit(metric) === "percentile" ? `min(${width}rem, var(--eqs-pct-max, ${width}rem))` : `${width}rem`,
    render: (row) => <MetricCell metric={metric} row={row} context={context} />,
    sortValue: (row) => metricValue(metric, row),
    firstSort: firstSortDirection(metric),
    hideBelow: phone ? undefined : "sm",
  };
}

/** Phones get 40px targets: the cell drops its padding and the control fills it. Row clicks skip these cells. */
const TOUCH_CELL = "eqs-control max-sm:px-0";

/** Selection checkbox, the metric columns, then the watchlist star. */
export function screenColumns(metrics: readonly MetricKey[], context: ScreenColumnContext): DataTableColumn<ScreenRow>[] {
  const { t } = context;
  const select: DataTableColumn<ScreenRow> = {
    key: "_select",
    header: (
      <Checkbox
        checked={context.allSelected}
        indeterminate={context.someSelected}
        disabled={context.visibleCount === 0}
        onChange={context.onToggleAll}
        label={<span className="sr-only">{tpl(t.screener.selection.selectAll, { n: context.visibleCount })}</span>}
        className="align-middle max-sm:-mx-3 max-sm:size-10 max-sm:items-center max-sm:justify-center"
      />
    ),
    width: `var(--eqs-select, ${SELECT_REM}rem)`,
    align: "center",
    className: TOUCH_CELL,
    render: (row) => (
      <Checkbox
        checked={context.selected.has(row.symbol)}
        onChange={() => context.onToggleSelect(row.symbol)}
        label={<span className="sr-only">{tpl(t.screener.selection.select, { symbol: row.symbol })}</span>}
        className="align-middle max-sm:size-10 max-sm:items-center max-sm:justify-center"
      />
    ),
  };
  const star: DataTableColumn<ScreenRow> = {
    key: "_star",
    header: <span className="sr-only">{t.screener.star.column}</span>,
    width: `var(--eqs-star, ${STAR_REM}rem)`,
    align: "center",
    className: cn(TOUCH_CELL, "py-0"),
    render: (row) => <WatchStar symbol={row.symbol} active={context.watchlist.has(row.symbol)} onToggle={context.onToggleWatch} />,
  };
  return [select, ...metrics.map((metric) => metricColumn(metric, context)), star];
}
