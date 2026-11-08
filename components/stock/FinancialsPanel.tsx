"use client";

import { useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { withTrueMinus } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useFinancials } from "@/hooks/useQuoteApi";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { displayedSign, formatCompact, formatNumber, formatRatio, tpl } from "@/lib/format";
import type { Lang } from "@/types/api";
import type { FinancialPeriod } from "@/types/research";

import { barWidths, FINANCIAL_ROWS, fiscalYear, yearOverYear, type FinancialRowSpec } from "./research-utils";

type Period = "annual" | "quarterly";

interface Row {
  spec: FinancialRowSpec;
  values: Array<number | null>;
  bars: Array<number | null>;
  yoy: number | null;
}

const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };

function formatValue(value: number | null, format: FinancialRowSpec["format"], lang: Lang): string {
  if (format === "ratio") return withTrueMinus(formatRatio(value, { digits: 1 }));
  if (format === "perShare") return withTrueMinus(formatNumber(value, 2, lang));
  return withTrueMinus(formatCompact(value, lang));
}

/** Prefixes an unsigned figure with + or a true minus by its printed sign (displayedSign): none when it prints as zero. */
function signed(text: string, sign: -1 | 0 | 1): string {
  return sign > 0 ? `+${text}` : sign < 0 ? `−${text}` : text;
}

/**
 * Income statement and cash flow highlights over four fiscal years or five quarters, with the latest year-over-year
 * change and a small bar per figure. Company figures are not price moves, so everything is in neutral ink.
 */
export function FinancialsPanel({ symbol, quoteCurrency, className }: { symbol: string; quoteCurrency: string | null; className?: string }) {
  const { t, lang } = usePrefs();
  const r = t.research.financials;
  const [period, setPeriod] = useState<Period>("annual");
  const { data, error, isLoading, mutate } = useFinancials(symbol);
  const quarterly = period === "quarterly";
  const periods: FinancialPeriod[] = data ? (quarterly ? data.quarterly : data.annual) : [];

  const ends = periods.map((p) => p.end);
  const rows: Row[] = FINANCIAL_ROWS.map((spec) => {
    const values = periods.map(spec.value);
    return { spec, values, bars: barWidths(values), yoy: yearOverYear(values, ends, spec.change) };
  }).filter((row) => row.values.some((v) => v !== null));

  const periodLabel = (end: string) =>
    quarterly
      ? new Intl.DateTimeFormat(LOCALES[lang], { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${end}T00:00:00Z`))
      : tpl(r.fiscalYear, { year: fiscalYear(end) });

  const columns: DataTableColumn<Row>[] = [
    { key: "metric", header: r.metric, width: "10rem", render: (row) => <span className="text-fg-2">{r.rows[row.spec.key]}</span> },
    ...periods.map(
      (p, i): DataTableColumn<Row> => ({
        key: p.end,
        header: periodLabel(p.end),
        title: p.end,
        align: "right",
        // Phones show the latest two periods next to the year-over-year column; wider screens show them all.
        hideBelow: i < periods.length - 2 ? "sm" : undefined,
        render: (row) => {
          const value = row.values[i];
          const width = row.bars[i];
          return (
            <span className="flex flex-col items-end gap-0.5">
              <span className="num text-fg">{formatValue(value, row.spec.format, lang)}</span>
              {width !== null ? (
                <span aria-hidden className="block h-0.5 w-full max-w-24">
                  <span className={cn("ml-auto block h-full", value !== null && value < 0 ? "bg-line-2" : "bg-fg-3")} style={{ width: `${Math.max(width, 2)}%` }} />
                </span>
              ) : null}
            </span>
          );
        },
      }),
    ),
    {
      key: "yoy",
      header: r.yoy,
      title: quarterly ? r.yoyQuarterly : r.yoyAnnual,
      align: "right",
      width: "5.5rem",
      render: (row) =>
        row.yoy === null ? (
          <span className="num text-fg-3">{formatRatio(null)}</span>
        ) : row.spec.change === "points" ? (
          <span className="num text-fg">{tpl(r.points, { n: signed(Math.abs(row.yoy).toFixed(1), displayedSign(row.yoy, 1)) })}</span>
        ) : (
          <span className="num text-fg">{signed(formatRatio(Math.abs(row.yoy), { digits: 1 }), displayedSign(row.yoy * 100, 1))}</span>
        ),
    },
  ];

  const currency = data?.currency ?? null;
  const notFound = error instanceof ApiError && error.status === 404;
  const periodOptions = [
    { value: "annual" as const, label: r.annual },
    { value: "quarterly" as const, label: r.quarterly },
  ];

  return (
    <Panel
      title={r.title}
      code="FA"
      className={className}
      // In the header from sm up; on phones the switch moves into the body with 40px segments.
      actions={<Segmented label={r.period} hideLabel size="sm" value={period} onChange={setPeriod} options={periodOptions} className="w-44 max-sm:hidden" />}
      footer={
        data ? (
          <div className="space-y-0.5 border-t border-line px-3 py-2 text-micro text-fg-3">
            <p>{r.fcfNote}</p>
            <p>{r.source}</p>
          </div>
        ) : null
      }
    >
      <StaleBanner show={Boolean(error && data)} since={data?.asOf} />
      <div className="border-b border-line px-3 py-2 sm:hidden">
        <Segmented label={r.period} hideLabel value={period} onChange={setPeriod} options={periodOptions} />
      </div>
      {currency ? (
        <p className={cn("border-b border-line px-3 py-1.5 text-xs", quoteCurrency && currency !== quoteCurrency ? "text-info" : "text-fg-3")}>
          {quoteCurrency && currency !== quoteCurrency ? tpl(r.currencyDiffers, { currency, trading: quoteCurrency }) : tpl(r.currency, { currency })}
        </p>
      ) : null}
      {notFound || (data && rows.length === 0) ? (
        <EmptyState>{tpl(r.empty, { symbol })}</EmptyState>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <SkeletonRows rows={10} />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(row) => row.spec.key} caption={`${r.title} · ${quarterly ? r.quarterly : r.annual}`} />
      )}
    </Panel>
  );
}
