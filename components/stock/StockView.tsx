"use client";

import { SearchX } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import { ResearchNote } from "@/components/ai/ResearchNote";
import { missingQuoteTab } from "@/components/help/landing";
import { TabLandingNote } from "@/components/help/TabLandingNote";
import { NotesPanel } from "@/components/notes/NotesPanel";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, ErrorState, Skeleton, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useQuotes, useSignal, useStock } from "@/hooks/useApi";
import { useHoldings, valuePositions } from "@/hooks/useHoldings";
import { useHotkeys } from "@/hooks/useHotkeys";
import { rememberSymbol } from "@/hooks/useLastSymbol";
import { useWatchlist } from "@/hooks/useWatchlist";
import { ApiError } from "@/lib/api-client";
import { tpl } from "@/lib/format";
import { symbolTitle } from "@/lib/names-zh";
import { holdingGroup } from "@/lib/sectors";
import { getSector } from "@/lib/universe";
import type { AnalyzeRequest, Quote } from "@/types/api";

import { AnalystsPanel } from "./AnalystsPanel";
import { DividendsTab } from "./DividendsTab";
import { EarningsPanel } from "./EarningsPanel";
import { FactorProfilePanel } from "./FactorProfilePanel";
import { FinancialsPanel } from "./FinancialsPanel";
import { KeyStats } from "./KeyStats";
import { NewsPanel } from "./NewsPanel";
import { OwnershipTab } from "./OwnershipTab";
import { PriceChart } from "./PriceChart";
import { ProfilePanel } from "./ProfilePanel";
import { QuoteHeader } from "./QuoteHeader";
import { liveTitle, parseCompare, QUOTE_TABS, quoteQuery, resolveTab, showsCoverage, tabsFor, type QuoteTab } from "./quote-utils";
import { QuoteTabs } from "./QuoteTabs";
import { RiskPanel } from "./RiskPanel";
import { SignalPanel } from "./SignalPanel";
import { useGSequenceGuard } from "./use-g-guard";

/**
 * Phone order of the overview panels. Only phones reorder: from sm to xl the single column follows the DOM (the left
 * stack, then the right one), so keyboard and screen-reader order match what is on screen wherever a keyboard is
 * likely. Static strings so Tailwind sees them.
 */
const ORDER = {
  chart: "max-sm:order-1",
  news: "max-sm:order-2",
  ai: "max-sm:order-3",
  stats: "max-sm:order-4",
  risk: "max-sm:order-5",
  earnings: "max-sm:order-6",
  signal: "max-sm:order-7",
  factors: "max-sm:order-8",
  analysts: "max-sm:order-9",
  notes: "max-sm:order-10",
  company: "max-sm:order-11",
} as const;

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

function HeaderSkeleton() {
  return (
    <div className="space-y-2 bg-panel px-4 py-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

/** Stand-in for the section tabs while the quote loads: which tabs apply depends on the quote type. */
function TabsSkeleton() {
  return (
    <div aria-hidden className="flex h-10 items-center gap-5 bg-panel px-5">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-14" />
    </div>
  );
}

/**
 * A panel hosted by this page but built by another feature (earnings, analysts). While it renders nothing, for
 * example before its data exists, the slot says so instead of leaving a blank tab.
 */
function HostedPanel({ children, empty }: { children: ReactNode; empty: string }) {
  return (
    <>
      <div className="peer empty:hidden">{children}</div>
      <div className="hidden bg-panel peer-empty:block">
        <EmptyState>{empty}</EmptyState>
      </div>
    </>
  );
}

/** The quote page of a well-formed symbol (the page answers 404 for one that cannot exist, before StockView renders). */
export function StockView({ symbol }: { symbol: string }) {
  const { t, lang } = usePrefs();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openChat, openPositionEditor, openAlertEditor } = useUi();
  const { data, error, isLoading, mutate } = useStock(symbol);
  const signal = useSignal(symbol);
  const watchlist = useWatchlist();
  const { holdings } = useHoldings();
  const inGSequence = useGSequenceGuard();
  const request = useMemo<AnalyzeRequest>(() => ({ kind: "stock", symbol, lang }), [symbol, lang]);

  const quote: Quote | null = data?.quote ?? null;
  // Which tabs apply depends on the quote type, so until the quote is known a deep link (?tab=financials) keeps its
  // tab but shows a skeleton: no research request goes out for a fund or an index that has no such tab.
  const tabs = data ? tabsFor(data.quote.quoteType) : QUOTE_TABS;
  const tab = resolveTab(searchParams.get("tab"), tabs);
  // A link to a tab this quote does not have (FA on a fund) shows the overview and says why.
  const missingTab = data ? missingQuoteTab(searchParams.get("tab"), tabs) : null;
  const compareParam = searchParams.get("compare");
  const compare = useMemo(() => parseCompare(compareParam, symbol), [compareParam, symbol]);

  const hrefFor = useCallback((next: QuoteTab) => `${pathname}${quoteQuery(next, compare)}`, [pathname, compare]);
  const setCompare = useCallback((next: string[]) => router.replace(`${pathname}${quoteQuery(tab, next)}`, { scroll: false }), [router, pathname, tab]);

  // The position and its share of the portfolio (needs quotes for the other holdings).
  const position = holdings[symbol];
  const otherHoldings = useMemo(() => (position ? Object.keys(holdings).filter((s) => s !== symbol) : []), [position, holdings, symbol]);
  const others = useQuotes(otherHoldings);
  const portfolioWeight = useMemo(() => {
    if (!position || !quote) return null;
    if (otherHoldings.length > 0 && !others.data) return null;
    const quotes = new Map<string, Quote>((others.data?.quotes ?? []).map((q) => [q.symbol, q]));
    quotes.set(quote.symbol, quote);
    return valuePositions(holdings, quotes).rows.find((row) => row.symbol === quote.symbol)?.weight ?? null;
  }, [position, quote, otherHoldings, others.data, holdings]);

  const sectorEtf = useMemo(() => {
    if (!data) return null;
    const group = holdingGroup(data.quote.symbol, data.quote.quoteType, data.profile.sector);
    return group.kind === "sector" ? (getSector(group.key)?.etf ?? null) : null;
  }, [data]);

  useEffect(() => {
    if (data) rememberSymbol(symbol);
  }, [data, symbol]);

  // Live tab title with arrows rather than colors, e.g. "NVDA 186.64 ▲2.78% · InvestSeek" ("英伟达 NVDA 186.64 ▲2.78%
  // · InvestSeek" in Chinese). Next.js writes the page's metadata title ("NVDA · InvestSeek") again on every navigation
  // within the page (?tab=, ?compare=, Back), so a head observer puts the live title back whenever it is replaced while
  // this quote is still the current page.
  const titleSymbol = quote?.symbol;
  const titlePrice = quote?.price ?? null;
  const titleChange = quote?.changePercent ?? null;
  useEffect(() => {
    if (!titleSymbol) return;
    const title = liveTitle(titleSymbol, titlePrice, titleChange, symbolTitle(titleSymbol, lang));
    const path = window.location.pathname;
    const apply = () => {
      if (window.location.pathname === path && document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [titleSymbol, titlePrice, titleChange, lang]);

  const why = useCallback(() => {
    openChat({ text: tpl(t.stock.actions.whyMovingPrompt, { symbol }), intent: { kind: "move", symbol } });
  }, [symbol, openChat, t]);

  const goToNotes = useCallback(() => {
    const focusNotes = () => {
      const notes = document.getElementById("notes");
      if (!notes) return;
      notes.scrollIntoView({ block: "start" });
      notes.querySelector<HTMLElement>("textarea, input, button, [tabindex]")?.focus({ preventScroll: true });
    };
    if (tab === "overview") focusNotes();
    else {
      router.push(`${hrefFor("overview")}#notes`, { scroll: false });
      window.setTimeout(focusNotes, 150);
    }
  }, [tab, router, hrefFor]);

  const outsideSequence = () => !inGSequence();
  useHotkeys(
    [
      { key: "a", description: t.stock.addToWatchlist, when: outsideSequence, handler: () => watchlist.toggle(symbol) },
      { key: "p", description: t.stock.actions.editPosition, when: outsideSequence, handler: () => openPositionEditor(symbol) },
      { key: "n", description: t.stock.actions.goToNotes, when: outsideSequence, handler: goToNotes },
      { key: "!", description: t.stock.actions.setAlert, handler: () => openAlertEditor(symbol) },
      { key: "w", description: t.stock.actions.whyMoving, when: outsideSequence, handler: why },
    ],
    Boolean(data),
  );

  if (error instanceof ApiError && error.status === 404) return <NotFound symbol={symbol} />;

  if (error && !data && !isLoading) {
    return (
      <div className="p-px">
        <div className="bg-panel">
          <ErrorState error={error} onRetry={() => mutate()} />
        </div>
      </div>
    );
  }

  const stale = Boolean(quote?.stale || (error && data));
  // No earnings or analyst panels for funds, indices, currencies and crypto (see showsCoverage).
  const coverage = showsCoverage(symbol, quote?.quoteType);

  return (
    <div>
      <div className="flex flex-col gap-px bg-line p-px">
        {data ? (
          <div>
            <StaleBanner show={stale} since={quote?.fetchedAt ?? data.asOf} />
            <QuoteHeader detail={data} inWatchlist={watchlist.has(data.quote.symbol)} onToggleWatchlist={() => watchlist.toggle(data.quote.symbol)} position={position} portfolioWeight={portfolioWeight} />
          </div>
        ) : (
          <HeaderSkeleton />
        )}
        {data ? <QuoteTabs tabs={tabs} active={tab} hrefFor={hrefFor} /> : <TabsSkeleton />}
        {data && missingTab ? <TabLandingNote symbol={data.quote.symbol} tab={missingTab} quoteType={data.quote.quoteType} /> : null}
      </div>

      {tab === "overview" ? (
        // Column flow: two independent stacks from xl up. Below xl the stacks dissolve (display: contents) into one
        // column in DOM order, and on phones in the order a phone reader needs: chart, news, AI note, key stats, risk,
        // earnings, signal, factors, analysts, notes, company.
        <div className="flex flex-col gap-px bg-line px-px pb-px xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start xl:gap-0 xl:bg-transparent xl:p-0">
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-px xl:bg-line xl:px-px xl:pb-px">
            <PriceChart symbol={symbol} quote={quote} sectorEtf={sectorEtf} compare={compare} onCompareChange={setCompare} className={ORDER.chart} />
            <SignalPanel report={signal.data} error={signal.error} onRetry={() => signal.mutate()} className={ORDER.signal} />
            <div id="risk" className={`${ORDER.risk} scroll-mt-2 empty:hidden`}>
              <RiskPanel symbol={symbol} />
            </div>
            <FactorProfilePanel symbol={symbol} className={ORDER.factors} />
            <ResearchNote title={t.stock.aiNote} request={request} ready={!!data} className={ORDER.ai} />
            <div id="notes" className={`${ORDER.notes} scroll-mt-2 empty:hidden`}>
              <NotesPanel symbol={symbol} price={quote?.price ?? null} />
            </div>
          </div>
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-px xl:bg-line xl:pr-px xl:pb-px">
            {data ? (
              <KeyStats stats={data.stats} quote={data.quote} className={ORDER.stats} />
            ) : (
              <Panel title={t.stock.keyStats} code="FA" className={ORDER.stats}>
                <SkeletonRows rows={14} />
              </Panel>
            )}
            {coverage ? <EarningsPanel symbol={symbol} className={ORDER.earnings} /> : null}
            {coverage ? <AnalystsPanel symbol={symbol} className={ORDER.analysts} /> : null}
            <NewsPanel symbol={symbol} ready={Boolean(data)} className={ORDER.news} />
            {data ? <ProfilePanel profile={data.profile} className={ORDER.company} /> : null}
          </div>
        </div>
      ) : !data ? (
        <div className="flex flex-col gap-px bg-line px-px pb-px">
          <Panel title={t.stock.tabs[tab]}>
            <SkeletonRows rows={8} />
          </Panel>
        </div>
      ) : (
        <div className="flex flex-col gap-px bg-line px-px pb-px">
          {tab === "financials" ? <FinancialsPanel symbol={symbol} quoteCurrency={quote?.currency ?? null} /> : null}
          {tab === "earnings" ? (
            <HostedPanel empty={tpl(t.research.hosted.earnings, { symbol })}>
              <EarningsPanel symbol={symbol} />
            </HostedPanel>
          ) : null}
          {tab === "analysts" ? (
            <HostedPanel empty={tpl(t.research.hosted.analysts, { symbol })}>
              <AnalystsPanel symbol={symbol} />
            </HostedPanel>
          ) : null}
          {tab === "dividends" ? <DividendsTab symbol={symbol} position={position} /> : null}
          {tab === "ownership" ? <OwnershipTab symbol={symbol} /> : null}
        </div>
      )}
    </div>
  );
}
