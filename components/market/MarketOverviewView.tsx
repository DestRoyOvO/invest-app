"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { ResearchNote } from "@/components/ai/ResearchNote";
import { WeekAheadPanel } from "@/components/calendar/WeekAheadPanel";
import { NewsList } from "@/components/news/NewsList";
import { MyDayPanel } from "@/components/portfolio/MyDayPanel";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { HeatLegend } from "@/components/ui/HeatLegend";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, Skeleton, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useOverview, useQuotes, useSparklines } from "@/hooks/useApi";
import { useBoard } from "@/hooks/useShellApi";
import { useWatchlist } from "@/hooks/useWatchlist";
import { formatTime, tpl } from "@/lib/format";
import type { AnalyzeRequest, Quote } from "@/types/api";

import { BreadthStrip } from "./BreadthStrip";
import { MarketBoard } from "./MarketBoard";
import { combineStaleness, stalenessOf } from "./metrics";
import { MoversPanel } from "./MoversPanel";
import { QuoteTable } from "./QuoteTable";
import { SectorBars } from "./SectorBars";
import { SectorHeatmap } from "./SectorHeatmap";

const STARTERS = ["AAPL", "MSFT", "NVDA", "SPY", "QQQ"];

function WatchlistPanel() {
  const { t } = usePrefs();
  const { symbols, hydrated, add } = useWatchlist();
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
      code="WL"
      actions={
        <Link href="/watchlist" className="flex items-center text-xs text-fg-3 transition-colors hover:text-fg max-sm:min-h-10">
          {t.common.viewAll}
        </Link>
      }
    >
      {!hydrated || (visible.length > 0 && !data && !error) ? (
        <SkeletonRows rows={5} />
      ) : visible.length === 0 ? (
        <EmptyState chips={STARTERS.map((symbol) => ({ label: symbol, onSelect: () => add(symbol) }))} chipsLabel={t.common.add}>
          {t.market.emptyWatchlist}
        </EmptyState>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={() => mutate()} compact />
      ) : (
        <>
          <StaleBanner show={Boolean(error && data)} since={data?.asOf} />
          <QuoteTable quotes={quotes} columns={["last", "changePct", "trend"]} sparklines={sparks} caption={t.market.watchlist} />
        </>
      )}
    </Panel>
  );
}

/**
 * The home page, personal first: my day and the week ahead, then the markets board, breadth, the heatmap and the movers
 * on the left; the watchlist, sectors, headlines and the AI brief on the right. Two independent column stacks
 * (docs/design-system.md, column flow), so no panel stretches to its neighbour; the heatmap grows into whatever height
 * the left column has to spare, up to a size that still reads at a glance. The movers table sits in the wide column,
 * where its names have room. DOM order is the phone order.
 *
 * The markets board reads the shell's board payload (useBoard: the ticker strip's data, about 13 KB, refreshed every
 * 15 s while trading), so it is on screen before the 80 KB overview arrives and ticks with the strip. Its stale banner
 * covers both feeds, as of the older one.
 */
export function MarketOverviewView() {
  const { t, lang } = usePrefs();
  const { data, error, mutate } = useOverview();
  const board = useBoard();
  const marketRequest = useMemo<AnalyzeRequest>(() => ({ kind: "market", lang }), [lang]);
  const failed = Boolean(error && !data);
  const boardFailed = Boolean(board.error && !board.data);
  const stale = combineStaleness([stalenessOf(board.data, Boolean(board.error)), stalenessOf(data, Boolean(error))]);

  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <h1 className="sr-only">{t.market.title}</h1>

      <div className="flex min-w-0 flex-col gap-px">
        <MyDayPanel />
        <WeekAheadPanel />

        <Panel
          title={t.market.board}
          code="WEI"
          actions={
            <>
              {board.data ? (
                <span className="hidden sm:inline">
                  <PanelMeta>{tpl(t.markets.asOfEt, { time: formatTime(board.data.asOf, lang, "America/New_York") })}</PanelMeta>
                </span>
              ) : null}
              <Link href="/markets" className="ml-2 flex items-center gap-1 text-xs text-fg-3 transition-colors hover:text-fg max-sm:min-h-10">
                {t.markets.worldLink}
                <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.75} />
              </Link>
            </>
          }
        >
          <StaleBanner show={stale.stale} since={stale.since} />
          {boardFailed ? <ErrorState error={board.error} onRetry={() => board.mutate()} compact /> : <MarketBoard board={board.data?.board} />}
        </Panel>

        <BreadthStrip breadth={data?.breadth} loading={!data && !error} />

        {/* Fills the spare height of the column, capped at about one screen so the whole map stays in view. */}
        <Panel title={t.market.heatmap} code="HMAP" actions={<HeatLegend />} className="flex-1 xl:max-h-[min(54rem,calc(100dvh_-_5rem))]" bodyClassName="flex flex-col">
          {data ? (
            <SectorHeatmap sectors={data.sectors} phoneList />
          ) : failed ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : (
            <Skeleton className="min-h-[420px] flex-1 rounded-none" />
          )}
        </Panel>

        <MoversPanel movers={data?.movers} loading={!data && !error} />
      </div>

      <div className="flex min-w-0 flex-col gap-px">
        <WatchlistPanel />
        {/* Phones get the same list, expandable, in place of the heatmap. */}
        <Panel title={t.market.sectorPerformance} code="SECT" className="max-sm:hidden">
          {data ? <SectorBars sectors={data.sectors} /> : failed ? <ErrorState error={error} onRetry={() => mutate()} compact /> : <SkeletonRows rows={8} />}
        </Panel>
        <Panel title={t.market.news} code="NEWS">
          {data ? (
            <NewsList news={data.news} limit={8} unavailable={data.warnings.includes("news")} />
          ) : failed ? (
            <ErrorState error={error} onRetry={() => mutate()} compact />
          ) : (
            <SkeletonRows rows={8} />
          )}
        </Panel>
        <ResearchNote title={t.market.aiBrief} request={marketRequest} ready={!!data} />
      </div>
    </div>
  );
}
