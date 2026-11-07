"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ResearchNote } from "@/components/ai/ResearchNote";
import { WeekAheadPanel } from "@/components/calendar/WeekAheadPanel";
import { NewsList } from "@/components/news/NewsList";
import { MyDayPanel } from "@/components/portfolio/MyDayPanel";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, Skeleton, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { useOverview, useQuotes, useSparklines } from "@/hooks/useApi";
import { useWatchlist } from "@/hooks/useWatchlist";
import { formatTime, tpl } from "@/lib/format";
import type { AnalyzeRequest, Quote } from "@/types/api";

import { MarketBoard } from "./MarketBoard";
import { QuoteTable } from "./QuoteTable";
import { SectorBars } from "./SectorBars";
import { SectorHeatmap } from "./SectorHeatmap";

type MoverTab = "gainers" | "losers" | "mostActive";

function WatchlistPanel() {
  const { t } = usePrefs();
  const { symbols, hydrated } = useWatchlist();
  const visible = symbols.slice(0, 10);
  const { data, error, mutate } = useQuotes(visible);
  const { data: sparks } = useSparklines(visible);
  const quotes = useMemo(() => {
    const bySymbol = new Map((data?.quotes ?? []).map((q) => [q.symbol, q]));
    return visible.map((s) => bySymbol.get(s)).filter((q): q is Quote => q !== undefined);
  }, [data, visible]);

  return (
    <Panel
      title={t.market.watchlist}
      actions={
        <Link href="/watchlist" className="text-xs text-fg-3 hover:text-fg">
          {t.common.viewAll}
        </Link>
      }
    >
      {!hydrated || (visible.length > 0 && !data && !error) ? (
        <SkeletonRows rows={5} />
      ) : visible.length === 0 ? (
        <EmptyState>{t.market.emptyWatchlist}</EmptyState>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={() => mutate()} compact />
      ) : (
        <QuoteTable quotes={quotes} columns={["last", "changePct", "trend"]} sparklines={sparks} caption={t.market.watchlist} />
      )}
    </Panel>
  );
}

export function MarketOverviewView() {
  const { t, lang } = usePrefs();
  const { data, error, isLoading, mutate } = useOverview();
  const [moverTab, setMoverTab] = useState<MoverTab>("gainers");
  const marketRequest = useMemo<AnalyzeRequest>(() => ({ kind: "market", lang }), [lang]);

  const movers = data ? (moverTab === "gainers" ? data.movers.gainers : moverTab === "losers" ? data.movers.losers : data.movers.mostActive) : [];

  if (error && !data && !isLoading) {
    return (
      <div className="p-px">
        <div className="bg-panel">
          <ErrorState error={error} onRetry={() => mutate()} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-px bg-line p-px lg:grid-cols-6 xl:grid-cols-12">
      <h1 className="sr-only">{t.market.title}</h1>

      <MyDayPanel className="lg:col-span-6 xl:col-span-8" />
      <WeekAheadPanel className="lg:col-span-6 xl:col-span-4" />

      <Panel
        title={t.market.board}
        actions={data ? <PanelMeta>{tpl(t.common.asOf, { time: formatTime(data.asOf, lang) })}</PanelMeta> : null}
        className="lg:col-span-6 xl:col-span-12"
      >
        <StaleBanner show={!!error && !!data} />
        <MarketBoard board={data?.board} />
      </Panel>

      <Panel title={t.market.heatmap} actions={<span className="hidden sm:inline"><PanelMeta>{t.market.heatmapHint}</PanelMeta></span>} className="lg:col-span-6 xl:col-span-8">
        {data ? <SectorHeatmap sectors={data.sectors} /> : <Skeleton className="h-[420px] rounded-none" />}
      </Panel>

      <div className="grid gap-px bg-line lg:col-span-6 lg:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
        <Panel title={t.market.sectorPerformance}>{data ? <SectorBars sectors={data.sectors} /> : <SkeletonRows rows={8} />}</Panel>
        <Panel
          title={t.market.movers}
          actions={
            <Tabs
              label={t.market.movers}
              value={moverTab}
              onChange={setMoverTab}
              options={[
                { value: "gainers", label: t.market.gainers },
                { value: "losers", label: t.market.losers },
                { value: "mostActive", label: t.market.mostActive },
              ]}
            />
          }
        >
          {data ? (
            <QuoteTable
              quotes={movers}
              columns={moverTab === "mostActive" ? ["last", "changePct", "dollarVolume"] : ["name", "last", "changePct"]}
              caption={t.market.movers}
            />
          ) : (
            <SkeletonRows rows={6} />
          )}
        </Panel>
      </div>

      <Panel title={t.market.news} className="lg:col-span-6 xl:col-span-8">
        {data ? <NewsList news={data.news} limit={12} twoColumn unavailable={data.warnings.includes("news")} /> : <SkeletonRows rows={8} />}
      </Panel>

      <div className="grid grid-rows-[auto_1fr] gap-px bg-line lg:col-span-6 xl:col-span-4">
        <WatchlistPanel />
        <ResearchNote title={t.market.aiBrief} request={marketRequest} ready={!!data} />
      </div>
    </div>
  );
}
