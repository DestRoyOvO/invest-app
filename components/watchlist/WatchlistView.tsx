"use client";

import { X } from "lucide-react";
import { useMemo } from "react";

import { ResearchNote } from "@/components/ai/ResearchNote";
import { dayFigures, dayTileCount } from "@/components/portfolio/day-figures";
import { DayTiles } from "@/components/portfolio/DayTiles";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Kbd } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { StatTile } from "@/components/ui/StatTile";
import { useToast } from "@/components/ui/Toast";
import { useSparklines } from "@/hooks/useApi";
import { useLocalStore } from "@/hooks/useLocalStore";
import { useNow, usePortfolio } from "@/hooks/usePortfolio";
import { useProfiles } from "@/hooks/usePortfolioApi";
import { useWatchlist } from "@/hooks/useWatchlist";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { plural } from "@/lib/i18n/plural";
import { MAX_WATCHLIST, sectorOfSymbol } from "@/lib/universe";
import type { AnalyzeRequest, Quote } from "@/types/api";

import { AddSymbolForm } from "./AddSymbolForm";
import { AllocationPanel } from "./AllocationPanel";
import { PositionsPanel } from "./PositionsPanel";
import { UpcomingPanel } from "./UpcomingPanel";
import { watchlistViewStore } from "./watchlist-view";
import { WatchlistTable } from "./WatchlistTable";

const ADD_INPUT_ID = "watchlist-add";
const STARTERS = ["NVDA", "AAPL", "MSFT", "SPY", "QQQ"];

/** Header label of a sortable watchlist column, for the "Sorted by" line. */
function columnLabel(key: string, t: Messages): string {
  const labels: Record<string, string> = {
    symbol: t.columns.symbol,
    name: t.columns.name,
    last: t.columns.last,
    changePct: t.columns.changePct,
    marketCap: t.columns.marketCap,
    pe: t.columns.pe,
  };
  return labels[key] ?? key;
}

/** Grid classes for a band of KPI tiles, chosen so no row ends in an empty cell. */
function bandGrid(count: number): string {
  if (count >= 6) return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6";
  if (count === 5) return "grid-cols-2 sm:grid-cols-5";
  if (count === 4) return "grid-cols-2 sm:grid-cols-4";
  return "grid-cols-3";
}

function watchlistBreadth(quotes: readonly Quote[]) {
  const changes = quotes.map((q) => q.changePercent).filter((c): c is number => typeof c === "number");
  return {
    avg: changes.length ? changes.reduce((s, c) => s + c, 0) / changes.length : null,
    up: changes.filter((c) => c > 0).length,
    down: changes.filter((c) => c < 0).length,
  };
}

export function WatchlistView() {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const { watchlist, holdings, quotes, portfolio, hydrated, loading, error, stale, staleSince, missing, refresh } = usePortfolio();
  const { add, addTyped, remove, insertAt, moveTo } = useWatchlist();
  const view = useLocalStore(watchlistViewStore);
  const { data: sparks } = useSparklines(watchlist);

  const valued = portfolio.rows.length > 0;
  // Yahoo profiles only for equities outside the stock universe, to group them by sector.
  const profileSymbols = useMemo(() => {
    const candidates = valued ? portfolio.rows.map((r) => r.symbol) : watchlist;
    return candidates.filter((s) => !sectorOfSymbol(s) && quotes.get(s)?.quoteType === "EQUITY");
  }, [valued, portfolio.rows, watchlist, quotes]);
  const { data: profiles } = useProfiles(profileSymbols);

  const request = useMemo<AnalyzeRequest | null>(() => {
    // The analyze schema accepts at most MAX_WATCHLIST positions; keep the largest by cost basis.
    const positions = Object.entries(holdings)
      .map(([symbol, p]) => ({ symbol, shares: p.shares, cost: p.cost }))
      .sort((a, b) => b.shares * b.cost - a.shares * a.cost)
      .slice(0, MAX_WATCHLIST);
    const base = watchlist.length > 0 ? watchlist : positions.map((p) => p.symbol);
    if (base.length === 0) return null;
    return positions.length > 0 ? { kind: "watchlist", symbols: base, lang, positions } : { kind: "watchlist", symbols: base, lang };
  }, [watchlist, holdings, lang]);

  const watchQuotes = useMemo(() => watchlist.map((s) => quotes.get(s)).filter((q): q is Quote => q !== undefined), [watchlist, quotes]);
  const breadth = watchlistBreadth(watchQuotes);
  const now = useNow();
  const figures = dayFigures(portfolio, quotes, now);
  const tileCount = valued ? dayTileCount(figures, true) + 1 : 3;
  const upcomingSymbols = useMemo(() => [...new Set([...Object.keys(holdings), ...watchlist])], [holdings, watchlist]);
  const weights = useMemo(() => new Map(portfolio.rows.map((r) => [r.symbol, r.weight])), [portfolio.rows]);
  const missingHere = missing.filter((s) => watchlist.includes(s));
  const showBand = hydrated && (valued || watchQuotes.length > 0);
  const bandLoading = hydrated && loading && (Object.keys(holdings).length > 0 || watchlist.length > 0);

  const onRemove = (symbol: string, index: number) => {
    remove(symbol);
    toast.show({ message: tpl(t.watchlist.removed, { symbol }), action: { label: t.watchlist.undo, onAction: () => insertAt(symbol, index) } });
  };

  const avgTile = (
    <StatTile
      key="avg"
      label={<span title={t.watchlist.avgChange}>{t.watchlist.avgShort}</span>}
      value={<Delta value={breadth.avg} />}
      sub={`${t.watchlist.equalWeighted} · ${tpl(t.watchlist.upDown, { up: breadth.up, down: breadth.down })}`}
      className={cn(tileCount === 5 && "max-sm:col-span-2")}
    />
  );

  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
      <h1 className="sr-only">{t.watchlist.title}</h1>

      {bandLoading ? (
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4 xl:col-span-2" aria-busy="true">
          {[t.watchlist.today, t.watchlist.unrealized, t.watchlist.costBasis, t.watchlist.avgShort].map((label) => (
            <StatTile key={label} label={label} value={<span aria-hidden className="inline-block h-5 w-24 animate-pulse rounded-xs bg-line align-middle" />} />
          ))}
        </div>
      ) : showBand ? (
        <div className={cn("grid gap-px bg-line xl:col-span-2", bandGrid(tileCount))}>
          {valued ? (
            <>
              <DayTiles figures={figures} costBasis />
              {avgTile}
            </>
          ) : (
            <>
              {avgTile}
              <StatTile label={t.watchlist.advancers} value={breadth.up} />
              <StatTile label={t.watchlist.decliners} value={breadth.down} />
            </>
          )}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-px">
        <Panel
          title={t.watchlist.title}
          code="WL"
          actions={
            <>
              <PanelMeta>{view.sort ? tpl(t.watchlist.sortedBy, { column: columnLabel(view.sort.key, t) }) : plural(t.watchlist.count, watchlist.length)}</PanelMeta>
              <button
                type="button"
                aria-pressed={view.sort === null}
                onClick={() => watchlistViewStore.write({ sort: null })}
                className={cn(
                  "-mb-px h-9 border-b-2 px-2 text-xs font-medium tracking-[0.04em] whitespace-nowrap uppercase transition-colors max-sm:h-10",
                  view.sort === null ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
                )}
              >
                {t.watchlist.sortCustom}
              </button>
            </>
          }
        >
          <AddSymbolForm onAdd={add} onAddTyped={addTyped} inputId={ADD_INPUT_ID} />
          <StaleBanner show={stale} since={staleSince} />
          {missingHere.length > 0 ? (
            <div role="status" className="flex flex-wrap items-center gap-2 border-t border-line bg-panel-2 px-3 py-1.5 text-xs text-warn">
              {tpl(t.watchlist.missing, { symbols: "" })}
              {missingHere.map((s) => (
                <span key={s} className="mono inline-flex items-center gap-1 rounded-xs border border-line-2 pl-1.5 text-fg-2">
                  {s}
                  <IconButton size="sm" label={tpl(t.watchlist.remove, { symbol: s })} icon={<X className="size-3" strokeWidth={2} />} onClick={() => remove(s)} />
                </span>
              ))}
            </div>
          ) : null}
          <div className="border-t border-line">
            {error && quotes.size === 0 && !loading ? (
              <ErrorState error={error} onRetry={refresh} />
            ) : (
              <WatchlistTable
                symbols={hydrated ? watchlist : []}
                quotes={quotes}
                holdings={holdings}
                sparklines={sparks}
                sort={view.sort}
                onSortChange={(sort) => watchlistViewStore.write({ sort })}
                onMove={moveTo}
                onRemove={onRemove}
                emptyFocusId={ADD_INPUT_ID}
                loading={!hydrated || (loading && watchlist.length > 0)}
                caption={t.watchlist.quotesCaption}
                empty={
                  <EmptyState
                    chips={STARTERS.map((s) => ({ label: s, onSelect: () => add(s) }))}
                    chipsLabel={t.watchlist.starters}
                    hint={
                      <>
                        <Kbd>/</Kbd> {t.watchlist.searchHint}
                      </>
                    }
                  >
                    {t.watchlist.empty}
                  </EmptyState>
                }
              />
            )}
          </div>
        </Panel>
        <PositionsPanel portfolio={portfolio} quotes={quotes} loading={!hydrated || (loading && Object.keys(holdings).length > 0)} />
      </div>

      <div className="flex min-w-0 flex-col gap-px">
        <AllocationPanel portfolio={portfolio} quotes={quotes} watchlist={watchlist} profiles={profiles} loading={!hydrated || loading} />
        {hydrated && upcomingSymbols.length > 0 ? <UpcomingPanel symbols={upcomingSymbols} weights={weights} /> : null}
        <ResearchNote title={t.watchlist.aiScan} request={request} ready={watchQuotes.length > 0 || valued} />
      </div>
    </div>
  );
}
