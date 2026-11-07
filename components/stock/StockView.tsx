"use client";

import { SearchX } from "lucide-react";
import { useEffect, useMemo } from "react";

import { ResearchNote } from "@/components/ai/ResearchNote";
import { NewsList } from "@/components/news/NewsList";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { ErrorState, Skeleton, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useSignal, useStock } from "@/hooks/useApi";
import { rememberSymbol } from "@/hooks/useLastSymbol";
import { useWatchlist } from "@/hooks/useWatchlist";
import { ApiError } from "@/lib/api-client";
import { tpl } from "@/lib/format";
import type { AnalyzeRequest } from "@/types/api";

import { NotesPanel } from "@/components/notes/NotesPanel";

import { AnalystsPanel } from "./AnalystsPanel";
import { EarningsPanel } from "./EarningsPanel";
import { FactorProfilePanel } from "./FactorProfilePanel";
import { KeyStats } from "./KeyStats";
import { PriceChart } from "./PriceChart";
import { ProfilePanel } from "./ProfilePanel";
import { QuoteHeader } from "./QuoteHeader";
import { RiskPanel } from "./RiskPanel";
import { SignalPanel } from "./SignalPanel";

function NotFound({ symbol }: { symbol: string }) {
  const { t } = usePrefs();
  const { openCommand } = useUi();
  return (
    <div className="p-px">
      <div className="flex flex-col items-center gap-3 bg-panel px-4 py-16 text-center">
        <SearchX aria-hidden className="size-6 text-fg-3" strokeWidth={1.5} />
        <h1 className="text-lg font-medium text-fg">{tpl(t.stock.notFound, { symbol })}</h1>
        <p className="max-w-sm text-sm text-fg-3">{t.stock.notFoundHint}</p>
        <Button variant="primary" onClick={openCommand}>
          {t.nav.search}
        </Button>
      </div>
    </div>
  );
}

export function StockView({ symbol, rawInput }: { symbol: string | null; rawInput: string }) {
  const { t, lang } = usePrefs();
  const { data, error, isLoading, mutate } = useStock(symbol);
  const signal = useSignal(symbol);
  const watchlist = useWatchlist();
  const request = useMemo<AnalyzeRequest | null>(() => (symbol ? { kind: "stock", symbol, lang } : null), [symbol, lang]);

  useEffect(() => {
    if (data && symbol) rememberSymbol(symbol);
  }, [data, symbol]);

  if (!symbol || (error instanceof ApiError && error.status === 404)) return <NotFound symbol={symbol ?? rawInput.slice(0, 20)} />;

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
    <div className="grid gap-px bg-line p-px xl:grid-cols-12">
      {data ? (
        <div className="xl:col-span-12">
          <StaleBanner show={!!error} />
          <QuoteHeader detail={data} inWatchlist={watchlist.has(data.quote.symbol)} onToggleWatchlist={() => watchlist.toggle(data.quote.symbol)} />
        </div>
      ) : (
        <div className="space-y-2 bg-panel px-4 py-4 xl:col-span-12">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      <PriceChart symbol={symbol} className="xl:col-span-8" />

      {data ? (
        <KeyStats stats={data.stats} quote={data.quote} className="xl:col-span-4 xl:row-span-2" />
      ) : (
        <Panel title={t.stock.keyStats} className="xl:col-span-4 xl:row-span-2">
          <SkeletonRows rows={14} />
        </Panel>
      )}

      <SignalPanel report={signal.data} error={signal.error} onRetry={() => signal.mutate()} className="xl:col-span-8" />

      <RiskPanel symbol={symbol} className="xl:col-span-8" />
      <FactorProfilePanel symbol={symbol} className="xl:col-span-8" />
      <EarningsPanel symbol={symbol} className="xl:col-span-4" />
      <AnalystsPanel symbol={symbol} className="xl:col-span-4" />

      <ResearchNote title={t.stock.aiNote} request={request} ready={!!data} className="xl:col-span-6" />
      <NotesPanel symbol={symbol} price={data?.quote.price ?? null} className="xl:col-span-6" />

      <Panel title={t.stock.news} className="xl:col-span-6">
        {data ? <NewsList news={data.news} showProvenance unavailable={data.warnings.includes("news")} /> : <SkeletonRows rows={8} />}
      </Panel>

      {data ? <ProfilePanel profile={data.profile} className="xl:col-span-12" /> : null}
    </div>
  );
}
