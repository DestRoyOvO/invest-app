"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import type { Position } from "@/hooks/useHoldings";
import { useDividends } from "@/hooks/useQuoteApi";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber, formatPrice, formatRatio, tpl } from "@/lib/format";
import type { DividendPayment } from "@/types/research";

import { dividendIncome, perShareDigits } from "./research-utils";

const LOCALES = { en: "en-US", zh: "zh-CN" } as const;

const RECENT_PAYMENTS = 12;

/**
 * Dividend history: yield, forward and trailing amounts, five-year growth, frequency and the next ex-date, a bar per
 * year and the latest payments. For a position, the income it pays and the yield on its average cost.
 */
export function DividendsTab({ symbol, position }: { symbol: string; position?: Position }) {
  const { t, lang } = usePrefs();
  const d = t.research.dividends;
  const { data, error, isLoading, mutate } = useDividends(symbol);

  if (error && !data) {
    return (
      <Panel title={d.title} code="DVD">
        <ErrorState error={error} onRetry={() => mutate()} />
      </Panel>
    );
  }
  if (isLoading || !data) {
    return (
      <Panel title={d.title} code="DVD">
        <SkeletonRows rows={6} />
      </Panel>
    );
  }
  if (data.payments.length === 0) {
    return (
      <Panel title={d.title} code="DVD">
        <EmptyState>{tpl(d.none, { symbol })}</EmptyState>
      </Panel>
    );
  }

  const annual = data.forwardAnnual ?? data.trailingAnnual;
  const income = position ? dividendIncome(position, annual) : null;
  const years = data.years.slice(-11);
  const most = Math.max(...years.map((y) => y.total), 0);
  const recent = [...data.payments].reverse().slice(0, RECENT_PAYMENTS);
  const money = (value: number | null) => formatPrice(value, lang);
  const perShare = (value: number | null) => {
    if (value === null) return formatPrice(null);
    const { min, max } = perShareDigits(value);
    return value.toLocaleString(LOCALES[lang], { minimumFractionDigits: min, maximumFractionDigits: max });
  };

  const columns: DataTableColumn<DividendPayment>[] = [
    { key: "exDate", header: d.exDate, render: (p) => <span className="num text-fg-2">{formatDate(`${p.exDate}T00:00:00Z`, lang, "UTC")}</span> },
    { key: "amount", header: d.amount, align: "right", width: "7rem", render: (p) => <span className="num text-fg">{perShare(p.amount)}</span> },
  ];

  return (
    <div className="flex flex-col gap-px">
      <Panel title={d.title} code="DVD" actions={data.currency ? <PanelMeta>{data.currency}</PanelMeta> : null}>
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 xl:grid-cols-6">
          <StatTile label={d.yieldLabel} value={formatRatio(data.yield, { digits: 2 })} />
          <StatTile label={d.forward} value={perShare(data.forwardAnnual)} />
          <StatTile label={d.trailing} value={perShare(data.trailingAnnual)} />
          <StatTile label={d.growth5y} value={formatRatio(data.growth5y, { digits: 1, sign: true })} sub={d.growthNote} />
          <StatTile label={d.frequency} value={data.frequency ? d.frequencies[data.frequency] : formatRatio(null)} />
          <StatTile
            label={d.nextEx}
            value={data.next ? formatDate(`${data.next.exDate}T00:00:00Z`, lang, "UTC") : formatRatio(null)}
            sub={data.next ? [data.next.amount !== null ? perShare(data.next.amount) : null, data.nextPayDate ? `${d.payDate} ${formatDate(`${data.nextPayDate}T00:00:00Z`, lang, "UTC")}` : null].filter(Boolean).join(" · ") : d.noneAnnounced}
          />
        </div>
        {income && position ? (
          <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
            <StatTile label={d.yourIncome} value={money(income.income)} sub={tpl(d.holderNote, { shares: formatNumber(position.shares, Number.isInteger(position.shares) ? 0 : 2, lang), cost: money(position.cost) })} />
            <StatTile label={d.yieldOnCost} value={formatRatio(income.yieldOnCost, { digits: 2 })} />
          </div>
        ) : null}
      </Panel>

      {/* The yearly chart fills its panel, so it stands as tall as the payments table beside it. */}
      <div className="grid gap-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title={d.perYear} bodyClassName="flex flex-col" footer={<p className="border-t border-line px-3 py-1.5 text-micro text-fg-3">{d.splitAdjusted}</p>}>
          <ul className="flex min-h-56 flex-1 items-end gap-1 px-3 pt-4 pb-2 sm:gap-2">
            {years.map((year) => {
              const height = most > 0 ? (year.total / most) * 100 : 0;
              return (
                <li key={year.year} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1" title={tpl(d.payments, { n: year.payments })}>
                  <span aria-hidden className="num text-[0.6875rem] whitespace-nowrap text-fg-2 max-sm:hidden">
                    {perShare(year.total)}
                  </span>
                  <span aria-hidden className="relative w-full max-w-10 flex-1">
                    <span
                      className={cn("absolute inset-x-0 bottom-0 rounded-t-xs", year.partial ? "border border-dashed border-fg-3" : "bg-fg-3")}
                      style={{ height: `${Math.max(height, 1.5)}%` }}
                    />
                  </span>
                  <span className="num text-[0.6875rem] text-fg-3">
                    <span className="sr-only">{year.partial ? tpl(d.yearToDate, { year: year.year }) : year.year}: {perShare(year.total)}</span>
                    <span aria-hidden>{year.partial ? `${String(year.year).slice(2)}*` : `'${String(year.year).slice(2)}`}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {years.at(-1)?.partial ? <p className="px-3 pb-2 text-micro text-fg-3">* {tpl(d.yearToDate, { year: years.at(-1)?.year ?? "" })}</p> : null}
        </Panel>
        <Panel title={d.recent}>
          <DataTable rows={recent} columns={columns} rowKey={(p) => p.exDate} caption={d.recent} />
        </Panel>
      </div>
    </div>
  );
}
