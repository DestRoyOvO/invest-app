"use client";

import Link from "next/link";
import { useMemo } from "react";

import { ResearchNote } from "@/components/ai/ResearchNote";
import { SectorHeatmap } from "@/components/market/SectorHeatmap";
import { NewsList } from "@/components/news/NewsList";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Delta, directionOf } from "@/components/ui/Delta";
import { HeatLegend } from "@/components/ui/HeatLegend";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { Sparkline } from "@/components/ui/Sparkline";
import { ErrorState, Skeleton, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { useHistory, useOverview, useQuotes, useSectorNews, useSparklines } from "@/hooks/useApi";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatCompact, formatPrice, tpl } from "@/lib/format";
import { SECTORS, type SectorDef } from "@/lib/universe";
import type { AnalyzeRequest, OverviewQuote } from "@/types/api";

import { EtfReturnsTable } from "./EtfReturnsTable";

function SectorTabs({ current }: { current: SectorDef }) {
  const { t, lang } = usePrefs();
  return (
    <nav aria-label={t.sector.title} className="no-scrollbar flex overflow-x-auto border-b border-line">
      {SECTORS.map((s) => (
        <Link
          key={s.key}
          href={`/sector/${s.key}`}
          aria-current={s.key === current.key ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2 text-xs whitespace-nowrap transition-colors max-sm:py-3",
            s.key === current.key ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
          )}
        >
          {s.short[lang]}
        </Link>
      ))}
    </nav>
  );
}

/**
 * A sector page in column flow: the sector's heatmap and its constituents on the left; its ETFs with trailing returns,
 * news and the AI scan on the right, each at its natural height.
 */
export function SectorView({ sector }: { sector: SectorDef }) {
  const { t, lang } = usePrefs();
  const { data, error, mutate } = useOverview();
  const snapshot = data?.sectors.find((s) => s.key === sector.key);
  const { data: sparks } = useSparklines(sector.stocks);
  const { data: news, error: newsError, mutate: retryNews } = useSectorNews(sector.key);
  const { data: etfs, error: etfsError, mutate: retryEtfs } = useQuotes(sector.relatedEtfs);
  const { data: history, error: historyError, mutate: retryHistory } = useHistory(sector.relatedEtfs, "1y");
  const request = useMemo<AnalyzeRequest>(() => ({ kind: "sector", sector: sector.key, lang }), [sector.key, lang]);
  const etf = etfs?.quotes.find((q) => q.symbol === sector.etf);

  const columns: DataTableColumn<OverviewQuote>[] = [
    { key: "symbol", header: t.columns.symbol, width: "5rem", render: (q) => <span className="mono font-medium text-fg">{q.symbol}</span>, sortValue: (q) => q.symbol },
    { key: "name", header: t.columns.name, hideBelow: "sm", render: (q) => <span className="text-fg-2" title={q.name}>{q.name}</span> },
    {
      key: "last",
      header: t.columns.last,
      align: "right",
      width: "5.5rem",
      render: (q) => <TickNumber value={q.price}>{formatPrice(q.price, lang)}</TickNumber>,
      sortValue: (q) => q.price,
    },
    { key: "chg", header: t.columns.changePct, align: "right", width: "5rem", render: (q) => <Delta value={q.changePercent} />, sortValue: (q) => q.changePercent },
    {
      key: "volume",
      header: t.columns.volume,
      align: "right",
      width: "5.5rem",
      hideBelow: "md",
      render: (q) => <span className="num text-fg-2">{formatCompact(q.volume, lang)}</span>,
      sortValue: (q) => q.volume,
    },
    {
      key: "cap",
      header: t.columns.marketCap,
      align: "right",
      // Room for "7364.65亿" in Chinese.
      width: "5.75rem",
      hideBelow: "sm",
      render: (q) => <span className="num text-fg-2">{formatCompact(q.marketCap, lang)}</span>,
      sortValue: (q) => q.marketCap,
    },
    {
      key: "pe",
      header: t.columns.pe,
      align: "right",
      width: "3.75rem",
      hideBelow: "lg",
      render: (q) => <span className="num text-fg-2">{q.trailingPE !== null ? q.trailingPE.toFixed(1) : "—"}</span>,
      sortValue: (q) => q.trailingPE,
    },
    {
      key: "trend",
      header: t.columns.trend,
      align: "right",
      width: "6.5rem",
      hideBelow: "sm",
      render: (q) => <Sparkline data={sparks?.[q.symbol] ?? []} width={72} height={20} tone={directionOf(q.changePercent)} />,
    },
  ];

  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <header className="min-w-0 bg-panel xl:col-span-2">
        <SectorTabs current={sector} />
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-fg">{sector.label[lang]}</h1>
            <p className="text-xs text-fg-2">
              {t.sector.weightedChange} <Delta value={snapshot?.changePercent} className="text-sm" />
            </p>
          </div>
          {etf ? (
            <Link href={stockPath(etf.symbol)} className="flex items-baseline gap-2 text-sm transition-colors hover:text-accent max-sm:min-h-10 max-sm:items-center">
              <span className="mono font-medium text-fg">{etf.symbol}</span>
              <TickNumber value={etf.price} className="text-fg-2">
                {formatPrice(etf.price, lang)}
              </TickNumber>
              <Delta value={etf.changePercent} />
            </Link>
          ) : null}
        </div>
      </header>

      <div className="flex min-w-0 flex-col gap-px">
        {/* The heatmap grows into whatever height the right-hand column leaves spare. */}
        <Panel title={t.market.heatmap} code="HMAP" actions={<HeatLegend />} className="flex-1" bodyClassName="flex flex-col">
          <StaleBanner show={Boolean(error && data)} since={data?.asOf} />
          {snapshot ? (
            <SectorHeatmap sectors={[snapshot]} headers={false} treemapClassName="min-h-[300px] flex-1 sm:min-h-[340px]" />
          ) : error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : (
            <Skeleton className="min-h-[300px] flex-1 rounded-none sm:min-h-[340px]" />
          )}
        </Panel>

        <Panel title={t.sector.constituents} code="MEMB" actions={<PanelMeta>{sector.stocks.length}</PanelMeta>}>
          <DataTable
            rows={snapshot?.stocks ?? []}
            columns={columns}
            rowKey={(q) => q.symbol}
            caption={tpl(t.sector.constituentsCaption, { sector: sector.label[lang] })}
            rowHref={(q) => stockPath(q.symbol)}
            loading={!snapshot && !error}
            loadingRows={8}
            empty={error ? t.common.dataUnavailable : undefined}
          />
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-px">
        <Panel title={t.markets.sector.etfReturns} code="ETF">
          {etfs ? (
            <EtfReturnsTable quotes={etfs.quotes} history={history} historyError={historyError} onRetryHistory={() => retryHistory()} />
          ) : etfsError ? (
            <ErrorState error={etfsError} onRetry={() => retryEtfs()} compact />
          ) : (
            <SkeletonRows rows={sector.relatedEtfs.length} />
          )}
        </Panel>

        <Panel title={t.sector.news} code="NEWS">
          {news ? (
            <NewsList news={news.news} limit={8} />
          ) : newsError ? (
            <ErrorState error={newsError} onRetry={() => retryNews()} compact />
          ) : (
            <SkeletonRows rows={6} />
          )}
        </Panel>

        <ResearchNote title={t.sector.aiScan} request={request} ready={!!snapshot} />
      </div>
    </div>
  );
}
