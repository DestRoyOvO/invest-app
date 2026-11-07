"use client";

import { Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";

import { ResearchNote } from "@/components/ai/ResearchNote";
import { QuoteTable } from "@/components/market/QuoteTable";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { IconButton } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { useQuotes, useSparklines } from "@/hooks/useApi";
import { useHoldings, valuePositions } from "@/hooks/useHoldings";
import { useWatchlist } from "@/hooks/useWatchlist";
import { formatNumber, tpl } from "@/lib/format";
import { MAX_WATCHLIST, sectorOfSymbol } from "@/lib/universe";
import type { AnalyzeRequest, Quote } from "@/types/api";

import { AddSymbolForm } from "./AddSymbolForm";
import { PositionEditor } from "./PositionEditor";
import { PositionsPanel } from "./PositionsPanel";

type SortKey = "custom" | "change" | "marketCap";

function Summary({ quotes, currency, portfolioValue, dayPnl }: { quotes: Quote[]; currency: string; portfolioValue: number | null; dayPnl: number | null }) {
  const { t, lang } = usePrefs();
  const changes = quotes.map((q) => q.changePercent).filter((c): c is number => c !== null);
  const avg = changes.length ? changes.reduce((s, c) => s + c, 0) / changes.length : null;
  const up = changes.filter((c) => c > 0).length;
  const down = changes.filter((c) => c < 0).length;

  const sectors = new Map<string, number>();
  for (const q of quotes) {
    const label = sectorOfSymbol(q.symbol)?.short[lang] ?? (q.quoteType === "ETF" ? "ETF" : t.watchlist.other);
    sectors.set(label, (sectors.get(label) ?? 0) + 1);
  }
  const mix = [...sectors.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-3 px-3 py-3">
      {portfolioValue !== null ? (
        <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
          <div>
            <div className="label">
              {t.portfolio.portfolioValue} · {currency}
            </div>
            <div className="num text-xl text-fg">{formatNumber(portfolioValue, 2, lang)}</div>
          </div>
          <div className="text-right">
            <div className="label">{t.portfolio.dayPnl}</div>
            <Delta value={dayPnl} kind="change" lang={lang} className="text-base" />
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-px bg-line [&>*]:bg-panel">
        <div className="py-1.5 pr-2">
          <div className="label">{t.watchlist.avgChange}</div>
          <Delta value={avg} className="text-lg" />
        </div>
        <div className="px-2 py-1.5">
          <div className="label">{t.watchlist.advancers}</div>
          <div className="num text-lg text-up">{up}</div>
        </div>
        <div className="px-2 py-1.5">
          <div className="label">{t.watchlist.decliners}</div>
          <div className="num text-lg text-down">{down}</div>
        </div>
      </div>
      {mix.length > 0 ? (
        <div>
          <div className="label mb-1.5">{t.columns.sector}</div>
          <div className="flex h-2 w-full overflow-hidden" aria-hidden>
            {mix.map(([label, count], i) => (
              <span key={label} className="h-full border-r border-panel last:border-r-0" style={{ width: `${(count / quotes.length) * 100}%`, background: `color-mix(in oklab, var(--info) ${90 - i * 12}%, var(--panel-2))` }} />
            ))}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {mix.map(([label, count]) => (
              <li key={label} className="flex justify-between gap-2 text-fg-2">
                <span className="truncate">{label}</span>
                <span className="num text-fg-3">{Math.round((count / quotes.length) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function WatchlistView() {
  const { t, lang } = usePrefs();
  const { symbols, hydrated, add, remove } = useWatchlist();
  const { holdings, setPosition, clearPosition } = useHoldings();
  const [editing, setEditing] = useState<string | null>(null);
  // Held symbols outside the watchlist get their own quote request, so neither list crowds the other out.
  const extraSymbols = useMemo(() => Object.keys(holdings).filter((s) => !symbols.includes(s)).slice(0, MAX_WATCHLIST), [symbols, holdings]);
  const { data, error, isLoading, mutate } = useQuotes(symbols);
  const { data: extraData, error: extraError } = useQuotes(extraSymbols);
  const { data: sparks } = useSparklines(symbols);
  const [sort, setSort] = useState<SortKey>("custom");
  const request = useMemo<AnalyzeRequest | null>(() => {
    // The analyze schema accepts at most MAX_WATCHLIST positions; keep the largest by cost basis.
    const positions = Object.entries(holdings)
      .map(([symbol, p]) => ({ symbol, shares: p.shares, cost: p.cost }))
      .sort((a, b) => b.shares * b.cost - a.shares * a.cost)
      .slice(0, MAX_WATCHLIST);
    const base = symbols.length > 0 ? symbols : positions.map((p) => p.symbol);
    if (base.length === 0) return null;
    return positions.length > 0 ? { kind: "watchlist", symbols: base, lang, positions } : { kind: "watchlist", symbols: base, lang };
  }, [symbols, holdings, lang]);

  const quotes = useMemo(() => {
    const bySymbol = new Map((data?.quotes ?? []).map((q) => [q.symbol, q]));
    const list = symbols.map((s) => bySymbol.get(s)).filter((q): q is Quote => q !== undefined);
    if (sort === "change") return [...list].sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));
    if (sort === "marketCap") return [...list].sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));
    return list;
  }, [data, symbols, sort]);

  const missing = data?.missing.filter((s) => symbols.includes(s)) ?? [];
  const portfolio = useMemo(() => {
    const all = [...(data?.quotes ?? []), ...(extraData?.quotes ?? [])];
    return valuePositions(holdings, new Map(all.map((q) => [q.symbol, { price: q.price, change: q.change, currency: q.currency }])));
  }, [data, extraData, holdings]);
  const hasHoldings = Object.keys(holdings).length > 0;
  const valued = portfolio.rows.length + portfolio.foreign.length;
  const positionsLoading =
    !hydrated || (hasHoldings && ((symbols.length > 0 && !data && !error) || (extraSymbols.length > 0 && !extraData && !extraError)));

  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-12">
      <h1 className="sr-only">{t.watchlist.title}</h1>
      <div className="grid grid-rows-[auto_1fr] gap-px bg-line xl:col-span-8">
      <Panel
        title={t.watchlist.title}
        actions={
          <>
            <PanelMeta>{tpl(t.watchlist.count, { n: symbols.length })}</PanelMeta>
            <Tabs
              label={t.watchlist.title}
              value={sort}
              onChange={setSort}
              options={[
                { value: "custom", label: t.watchlist.sortCustom },
                { value: "change", label: t.columns.changePct },
                { value: "marketCap", label: t.columns.marketCap },
              ]}
            />
          </>
        }
      >
        <AddSymbolForm onAdd={add} />
        <StaleBanner show={!!error && !!data} />
        {missing.length > 0 ? (
          <div role="status" className="flex flex-wrap items-center gap-2 border-y border-line bg-panel-2 px-3 py-1.5 text-xs text-warn">
            {tpl(t.watchlist.missing, { symbols: "" })}
            {missing.map((s) => (
              <span key={s} className="mono inline-flex items-center gap-1 rounded-xs border border-line-2 pl-1.5 text-fg-2">
                {s}
                <IconButton size="sm" label={tpl(t.watchlist.remove, { symbol: s })} icon={<X className="size-3" strokeWidth={2} />} onClick={() => remove(s)} className="size-5" />
              </span>
            ))}
          </div>
        ) : null}
        <div className="border-t border-line">
          {!hydrated || (isLoading && !data) ? (
            <SkeletonRows rows={6} />
          ) : symbols.length === 0 ? (
            <EmptyState>{t.watchlist.empty}</EmptyState>
          ) : error && !data ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : (
            <QuoteTable
              quotes={quotes}
              columns={["name", "last", "change", "changePct", "volume", "marketCap", "pe", "trend"]}
              sparklines={sparks}
              caption={t.watchlist.title}
              rowAction={(q) => (
                <span className="inline-flex">
                  <IconButton size="sm" label={tpl(t.portfolio.editShort, { symbol: q.symbol })} icon={<Pencil className="size-3.5" strokeWidth={1.75} />} active={!!holdings[q.symbol]} onClick={() => setEditing(q.symbol)} />
                  <IconButton size="sm" label={tpl(t.watchlist.remove, { symbol: q.symbol })} icon={<X className="size-3.5" strokeWidth={1.75} />} onClick={() => remove(q.symbol)} />
                </span>
              )}
            />
          )}
        </div>
      </Panel>
      <PositionsPanel portfolio={portfolio} loading={positionsLoading} onEdit={setEditing} />
      </div>

      <div className="grid grid-rows-[auto_1fr] gap-px bg-line xl:col-span-4">
        <Panel title={t.watchlist.summary}>
          {!hydrated || (isLoading && !data) || positionsLoading ? (
            <SkeletonRows rows={3} />
          ) : quotes.length === 0 && valued === 0 ? (
            <EmptyState>{t.watchlist.summaryEmpty}</EmptyState>
          ) : (
            <Summary
              quotes={quotes}
              currency={portfolio.baseCurrency}
              portfolioValue={portfolio.rows.length ? portfolio.totals.value : null}
              dayPnl={portfolio.rows.length ? portfolio.totals.dayPnl : null}
            />
          )}
        </Panel>
        <ResearchNote title={t.watchlist.aiScan} request={request} ready={quotes.length > 0 || valued > 0} />
      </div>

      <PositionEditor symbol={editing} current={editing ? holdings[editing] : undefined} onSave={setPosition} onClear={clearPosition} onClose={() => setEditing(null)} />
    </div>
  );
}
