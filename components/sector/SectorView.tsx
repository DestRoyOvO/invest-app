"use client";

import Link from "next/link";
import { useMemo } from "react";

import { ResearchNote } from "@/components/ai/ResearchNote";
import { QuoteTable } from "@/components/market/QuoteTable";
import { SectorHeatmap } from "@/components/market/SectorHeatmap";
import { NewsList } from "@/components/news/NewsList";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { ErrorState, Skeleton, SkeletonRows } from "@/components/ui/States";
import { useOverview, useQuotes, useSectorNews, useSparklines } from "@/hooks/useApi";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { SECTORS, type SectorDef } from "@/lib/universe";
import type { AnalyzeRequest } from "@/types/api";

function SectorTabs({ current }: { current: SectorDef }) {
  const { t, lang } = usePrefs();
  return (
    <nav aria-label={t.sector.title} className="no-scrollbar flex overflow-x-auto border-b border-line bg-panel">
      {SECTORS.map((s) => (
        <Link
          key={s.key}
          href={`/sector/${s.key}`}
          aria-current={s.key === current.key ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2 text-xs whitespace-nowrap transition-colors",
            s.key === current.key ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
          )}
        >
          {s.short[lang]}
        </Link>
      ))}
    </nav>
  );
}

export function SectorView({ sector }: { sector: SectorDef }) {
  const { t, lang } = usePrefs();
  const { data, error, mutate } = useOverview();
  const snapshot = data?.sectors.find((s) => s.key === sector.key);
  const { data: sparks } = useSparklines(sector.stocks);
  const { data: news, error: newsError, mutate: retryNews } = useSectorNews(sector.key);
  const { data: etfs, error: etfsError, mutate: retryEtfs } = useQuotes(sector.relatedEtfs);
  const request = useMemo<AnalyzeRequest>(() => ({ kind: "sector", sector: sector.key, lang }), [sector.key, lang]);

  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-12">
      <div className="xl:col-span-12">
        <SectorTabs current={sector} />
        <div className="flex flex-wrap items-end justify-between gap-3 bg-panel px-4 py-3">
          <div>
            <h1 className="text-xl font-semibold text-fg">{sector.label[lang]}</h1>
            <p className="text-xs text-fg-3">
              {t.sector.weightedChange} <Delta value={snapshot?.changePercent} className="text-sm" />
            </p>
          </div>
          {snapshot?.etf ? (
            <Link href={stockPath(snapshot.etf.symbol)} className="flex items-baseline gap-2 text-sm hover:text-accent">
              <span className="num font-medium text-fg">{snapshot.etf.symbol}</span>
              <span className="num text-fg-2">{formatPrice(snapshot.etf.price, lang)}</span>
              <Delta value={snapshot.etf.changePercent} />
            </Link>
          ) : null}
        </div>
      </div>

      <Panel title={t.market.heatmap} className="xl:col-span-5">
        {snapshot ? (
          <SectorHeatmap sectors={[{ ...snapshot }]} className="relative h-[360px] w-full overflow-hidden bg-canvas" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : (
          <Skeleton className="h-[360px] rounded-none" />
        )}
      </Panel>

      <Panel title={t.sector.constituents} actions={<PanelMeta>{sector.stocks.length}</PanelMeta>} className="xl:col-span-7">
        {snapshot ? (
          <QuoteTable quotes={snapshot.stocks} columns={["name", "last", "changePct", "volume", "marketCap", "pe", "trend"]} sparklines={sparks} caption={t.sector.constituents} />
        ) : (
          <SkeletonRows rows={8} />
        )}
      </Panel>

      <Panel title={t.sector.etfs} className="xl:col-span-4">
        {etfs ? (
          <QuoteTable quotes={etfs.quotes} columns={["name", "last", "changePct"]} caption={t.sector.etfs} />
        ) : etfsError ? (
          <ErrorState error={etfsError} onRetry={() => retryEtfs()} />
        ) : (
          <SkeletonRows rows={3} />
        )}
      </Panel>

      <Panel title={t.sector.news} className="xl:col-span-4">
        {news ? (
          <NewsList news={news.news} limit={10} />
        ) : newsError ? (
          <ErrorState error={newsError} onRetry={() => retryNews()} />
        ) : (
          <SkeletonRows rows={6} />
        )}
      </Panel>

      <ResearchNote title={t.sector.aiScan} request={request} ready={!!snapshot} className="xl:col-span-4" />
    </div>
  );
}
