"use client";

import { useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { withTrueMinus } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useOwnership } from "@/hooks/useQuoteApi";
import { ApiError } from "@/lib/api-client";
import { formatCompact, formatDate, formatInteger, formatPrice, formatRatio, tpl } from "@/lib/format";
import type { Lang } from "@/types/api";
import type { InsiderTrade, InstitutionHolder } from "@/types/research";

import { isUsListing } from "./quote-utils";
import { readableName } from "./research-utils";

const COLLAPSED_TRADES = 10;

/** Institutions below this share of the company (0.01%) are left out: in a foreign listing's US filings they are noise. */
const MIN_INSTITUTION_HELD = 0.0001;

function isoDay(date: string | null): string | null {
  return date ? `${date}T00:00:00Z` : null;
}

/** Signed share count in neutral ink: insider activity is a fact about filings, not a price move. */
function signedCompact(value: number | null, lang: Lang): string {
  if (value === null) return formatCompact(null, lang);
  const text = formatCompact(Math.abs(value), lang);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

type Trade = InsiderTrade & { index: number };

/**
 * Who owns the stock: the insider and institutional shares, insider buying and selling over six months, the latest
 * insider trades and the largest institutions with the dates of their filings. Yahoo takes these from US filings, so
 * for a listing outside the US (0700.HK) they describe the US-traded shares: prices and values in another currency
 * than the listing's are left out and a note says so.
 */
export function OwnershipTab({ symbol }: { symbol: string }) {
  const { t, lang } = usePrefs();
  const o = t.research.ownership;
  const { data, error, isLoading, mutate } = useOwnership(symbol);
  const [allTrades, setAllTrades] = useState(false);

  if (error instanceof ApiError && error.status === 404) {
    return (
      <Panel title={o.title} code="HDS">
        <EmptyState>{tpl(o.empty, { symbol })}</EmptyState>
      </Panel>
    );
  }
  if (error && !data) {
    return (
      <Panel title={o.title} code="HDS">
        <ErrorState error={error} onRetry={() => mutate()} />
      </Panel>
    );
  }
  if (isLoading || !data) {
    return (
      <Panel title={o.title} code="HDS">
        <SkeletonRows rows={6} />
      </Panel>
    );
  }

  const b = data.breakdown;
  const s = data.insiderSummary;
  const usListing = isUsListing(symbol);
  // Yahoo lists identical rows (eight equal awards on one day), so rows are keyed by position.
  const trades: Trade[] = data.insiderTrades.map((trade, index) => ({ ...trade, index }));
  const shownTrades = allTrades ? trades : trades.slice(0, COLLAPSED_TRADES);
  const institutions = data.institutions.filter((row) => row.pctHeld === null || row.pctHeld >= MIN_INSTITUTION_HELD);

  const tradeColumns: DataTableColumn<Trade>[] = [
    { key: "date", header: o.cols.date, width: "7rem", hideBelow: "sm", render: (trade) => <span className="num text-fg-2">{formatDate(isoDay(trade.date), lang, "UTC")}</span> },
    {
      key: "insider",
      header: o.cols.insider,
      // Phones drop the date and type columns: both go on a second line under the name, which may wrap.
      className: "max-sm:py-1.5 max-sm:whitespace-normal",
      render: (trade) => (
        <span className="block min-w-0">
          <span className="block truncate max-sm:whitespace-normal" title={[trade.name, trade.relation].filter(Boolean).join(" · ")}>
            <span className="text-fg">{readableName(trade.name)}</span>
            {trade.relation ? <span className="text-fg-3"> · {trade.relation}</span> : null}
          </span>
          <span className="num block text-xs text-fg-2 sm:hidden">
            {o.kinds[trade.kind]} · {formatDate(isoDay(trade.date), lang, "UTC")}
          </span>
        </span>
      ),
    },
    {
      key: "type",
      header: o.cols.type,
      width: "9rem",
      hideBelow: "sm",
      render: (trade) => (
        <span className="text-fg-2">
          {o.kinds[trade.kind]}
          {trade.ownership === "I" ? <span className="text-fg-3"> · {o.indirect}</span> : null}
        </span>
      ),
    },
    { key: "shares", header: o.cols.shares, align: "right", width: "6.5rem", render: (trade) => <span className="num text-fg">{formatInteger(trade.shares, lang)}</span> },
    ...(usListing
      ? [
          { key: "price", header: o.cols.price, align: "right", width: "6rem", hideBelow: "md", render: (trade) => <span className="num text-fg-2">{formatPrice(trade.price, lang)}</span> },
          { key: "value", header: o.cols.value, align: "right", width: "6.5rem", render: (trade) => <span className="num text-fg">{formatCompact(trade.value, lang)}</span> },
        ] satisfies DataTableColumn<Trade>[]
      : []),
  ];

  const institutionColumns: DataTableColumn<InstitutionHolder>[] = [
    { key: "holder", header: o.instCols.holder, render: (row) => <span className="text-fg" title={row.name}>{row.name}</span> },
    { key: "held", header: o.instCols.held, align: "right", width: "5rem", render: (row) => <span className="num text-fg">{formatRatio(row.pctHeld, { digits: 2 })}</span> },
    { key: "shares", header: o.instCols.shares, align: "right", width: "6rem", hideBelow: "sm", render: (row) => <span className="num text-fg-2">{formatCompact(row.shares, lang)}</span> },
    ...(usListing
      ? [
          { key: "value", header: o.instCols.value, align: "right", width: "6rem", hideBelow: "md", render: (row) => <span className="num text-fg-2">{formatCompact(row.value, lang)}</span> },
        ] satisfies DataTableColumn<InstitutionHolder>[]
      : []),
    {
      key: "change",
      header: o.instCols.change,
      align: "right",
      width: "5.5rem",
      hideBelow: "md",
      render: (row) => <span className="num text-fg-2">{withTrueMinus(formatRatio(row.pctChange, { digits: 1, sign: true }))}</span>,
    },
    { key: "reported", header: o.instCols.reported, align: "right", width: "7rem", render: (row) => <span className="num text-fg-3">{formatDate(isoDay(row.reportDate), lang, "UTC")}</span> },
  ];

  return (
    <div className="flex flex-col gap-px">
      <Panel title={o.title} code="HDS">
        <StaleBanner show={Boolean(error && data)} since={data.asOf} />
        {usListing ? null : <p className="border-b border-line px-3 py-2 text-xs text-fg-2">{tpl(o.foreignListing, { symbol })}</p>}
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          <StatTile label={o.insiders} value={formatRatio(b?.insiders, { digits: 2 })} />
          <StatTile label={o.institutions} value={formatRatio(b?.institutions, { digits: 1 })} />
          <StatTile label={o.institutionsFloat} value={formatRatio(b?.institutionsFloat, { digits: 1 })} />
          <StatTile label={o.institutionsCount} value={formatInteger(b?.institutionsCount, lang)} />
        </div>
        {s ? (
          <div className="border-t border-line px-3 py-2.5">
            <h3 className="col-head">{o.insiderActivity}</h3>
            <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-3">{o.acquired}</dt>
                <dd className="num text-fg">
                  {formatCompact(s.buyShares, lang)} <span className="text-xs text-fg-3">{s.buyCount !== null ? tpl(o.transactions, { n: s.buyCount }) : null}</span>
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-3">{o.sold}</dt>
                <dd className="num text-fg">
                  {formatCompact(s.sellShares, lang)} <span className="text-xs text-fg-3">{s.sellCount !== null ? tpl(o.transactions, { n: s.sellCount }) : null}</span>
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-3">{o.net}</dt>
                <dd className="num text-fg">
                  {signedCompact(s.netShares, lang)}{" "}
                  {s.netPercent !== null ? <span className="text-xs text-fg-3">{tpl(o.ofHoldings, { pct: withTrueMinus(formatRatio(s.netPercent, { digits: 1, sign: true })) })}</span> : null}
                </dd>
              </div>
            </dl>
            <p className="mt-1 text-micro text-fg-3">{o.awardsNote}</p>
          </div>
        ) : null}
      </Panel>

      <Panel
        title={o.trades}
        footer={
          trades.length > COLLAPSED_TRADES ? (
            <div className="border-t border-line px-1.5 py-1">
              <Button size="sm" variant="ghost" aria-expanded={allTrades} onClick={() => setAllTrades((v) => !v)}>
                {allTrades ? t.common.less : tpl(o.showAll, { n: trades.length })}
              </Button>
            </div>
          ) : null
        }
      >
        <DataTable rows={shownTrades} columns={tradeColumns} rowKey={(trade) => String(trade.index)} caption={o.tradesCaption} empty={o.noTrades} />
      </Panel>

      <Panel title={o.topInstitutions} footer={<p className="border-t border-line px-3 py-1.5 text-micro text-fg-3">{o.lag}</p>}>
        <DataTable rows={institutions} columns={institutionColumns} rowKey={(row) => row.name} caption={o.institutionsCaption} empty={o.noInstitutions} />
      </Panel>
    </div>
  );
}
