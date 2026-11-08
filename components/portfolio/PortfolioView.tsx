"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Button } from "@/components/ui/Button";
import { Delta, withTrueMinus } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { StatTile } from "@/components/ui/StatTile";
import { Tabs } from "@/components/ui/Tabs";
import { TickNumber } from "@/components/ui/TickNumber";
import { useHistory, useQuotes } from "@/hooks/useApi";
import { useLocalStore } from "@/hooks/useLocalStore";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useProfiles } from "@/hooks/usePortfolioApi";
import { formatDate, formatNumber, formatRatio, formatShortDate, tpl } from "@/lib/format";
import { analyzeRisk, effectivePositionCount, historySymbols, projectedDividends, selectAnalyzed } from "@/lib/portfolio-analytics";
import { sectorOfSymbol } from "@/lib/universe";

import { CorrelationTab } from "./CorrelationTab";
import { CoveragePanel, MethodPanel } from "./CoveragePanel";
import { dayFigures } from "./DayTiles";
import { ExposureTab, fxSymbols } from "./ExposureTab";
import { LINK_BUTTON } from "./MyDayPanel";
import { Money, SignedMoney } from "./money";
import { PerformanceTab } from "./PerformanceTab";
import { portViewStore, type PortTab } from "./port-view";
import { RiskTab } from "./RiskTab";

/** Sessions of a full year: fewer means a holding's history starts later, and the page says so. */
const FULL_YEAR_SESSIONS = 240;

/** A figure that waits for the price history: an inline placeholder while it loads. */
function pending(loading: boolean, node: ReactNode) {
  return loading ? <span aria-hidden className="inline-block h-5 w-20 animate-pulse rounded-xs bg-line align-middle" /> : node;
}

/**
 * The portfolio page (PORT; the CORR tab): KPIs of today's positions and of their past year, then hypothetical
 * performance against SPY or QQQ, exposure, risk by position and correlations. Everything uses the base-currency
 * positions (lib/portfolio.ts); the 24 largest are analyzed against SPY (lib/portfolio-analytics.ts).
 */
export function PortfolioView({ initialTab }: { initialTab: PortTab }) {
  const { t, lang } = usePrefs();
  const { openPositionEditor } = useUi();
  const { holdings, quotes, portfolio, hydrated, loading, error, stale, staleSince, refresh } = usePortfolio();
  const prefs = useLocalStore(portViewStore);
  const [tab, setTab] = useState<PortTab>(initialTab);

  const selection = useMemo(() => selectAnalyzed(portfolio.rows), [portfolio.rows]);
  const analyzedKey = selection.analyzed.map((p) => p.symbol).sort().join(",");
  // Sorted so the request stays the same while prices reorder the positions.
  const requestSymbols = useMemo(() => (analyzedKey ? historySymbols(analyzedKey.split(",").map((symbol) => ({ symbol }))).sort() : []), [analyzedKey]);
  const history = useHistory(requestSymbols, "1y");
  const qqq = useHistory(prefs.benchmark === "QQQ" && requestSymbols.length > 0 ? ["QQQ"] : [], "1y");
  const report = useMemo(() => analyzeRisk(selection.analyzed, history.data ?? null), [selection, history.data]);
  const historyLoading = requestSymbols.length > 0 && !history.data && !history.error;

  const profileSymbols = useMemo(() => portfolio.rows.filter((r) => !sectorOfSymbol(r.symbol) && quotes.get(r.symbol)?.quoteType === "EQUITY").map((r) => r.symbol), [portfolio.rows, quotes]);
  const { data: profiles } = useProfiles(profileSymbols);
  const infoOf = (symbol: string) => ({ quoteType: quotes.get(symbol)?.quoteType ?? null, sector: profiles?.profiles[symbol]?.sector ?? null });
  const fxList = useMemo(() => fxSymbols(portfolio), [portfolio]);
  const { data: fxData } = useQuotes(fxList);
  const fx = useMemo(() => new Map((fxData?.quotes ?? []).map((q) => [q.symbol, q])), [fxData]);

  const figures = dayFigures(portfolio, quotes);
  const dividends = projectedDividends(portfolio.rows, (s) => quotes.get(s)?.dividendRate ?? null);
  const effective = effectivePositionCount(portfolio.rows);
  const k = t.port.kpi;
  const pct = (v: number | null, digits = 1) => withTrueMinus(formatRatio(v, { digits }));
  const held = Object.keys(holdings).length;

  const changeTab = (next: PortTab) => {
    setTab(next);
    window.history.replaceState(window.history.state, "", next === "overview" ? window.location.pathname : `?tab=${next}`);
  };

  if (hydrated && held === 0) {
    return (
      <div className="p-px">
        <h1 className="sr-only">{t.port.title}</h1>
        <Panel title={t.port.analytics} code="PORT">
          <EmptyState
            actions={
              <>
                <Button size="sm" variant="primary" onClick={() => openPositionEditor("")} className="max-sm:h-10">
                  {t.portfolio.addPosition}
                </Button>
                <Link href="/data#paste" className={LINK_BUTTON}>
                  {t.portfolio.pastePositions}
                </Link>
                <Link href="/watchlist" className={LINK_BUTTON}>
                  {t.watchlist.title}
                </Link>
              </>
            }
          >
            {t.port.empty}
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const quotesLoading = !hydrated || loading;

  const tiles = (
    <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-5 xl:col-span-2">
      <StatTile
        label={tpl(k.value, { currency: figures.currency })}
        value={pending(quotesLoading, <TickNumber value={figures.value}>{formatNumber(figures.value, 2, lang)}</TickNumber>)}
        sub={tpl(t.watchlist.positionsCount, { n: figures.positions })}
      />
      <StatTile
        label={k.dayPnl}
        value={pending(quotesLoading, <TickNumber value={figures.dayPnl}><SignedMoney value={figures.dayPnl} lang={lang} /></TickNumber>)}
        delta={quotesLoading ? undefined : <Delta value={figures.dayRatio} kind="ratio" digits={2} />}
      />
      <StatTile
        label={k.unrealized}
        value={pending(quotesLoading, <SignedMoney value={figures.pnl} lang={lang} />)}
        delta={quotesLoading ? undefined : <Delta value={figures.pnlPct} kind="ratio" digits={1} />}
      />
      <StatTile label={t.watchlist.costBasis} value={pending(quotesLoading, <Money value={figures.costBasis} lang={lang} />)} />
      <StatTile
        label={k.dividends}
        value={pending(quotesLoading, <Money value={dividends.amount} lang={lang} />)}
        sub={tpl(k.dividendsSub, { n: dividends.payers, m: dividends.positions })}
      />
      <StatTile label={k.beta} value={pending(historyLoading || quotesLoading, report.beta === null ? "—" : withTrueMinus(report.beta.toFixed(2)))} sub={k.betaSub} />
      <StatTile label={k.volatility} value={pending(historyLoading || quotesLoading, pct(report.volatility))} sub={k.volatilitySub} />
      <StatTile
        label={k.var}
        value={pending(historyLoading || quotesLoading, report.varAmount === null ? "—" : formatNumber(report.varAmount, 2, lang))}
        delta={report.varRatio === null || historyLoading ? undefined : <span className="num text-fg-2">{pct(report.varRatio)}</span>}
        sub={k.varSub}
      />
      <StatTile
        label={k.maxDrawdown}
        value={pending(historyLoading || quotesLoading, report.maxDrawdown ? pct(report.maxDrawdown.depth) : "—")}
        sub={report.maxDrawdown && report.maxDrawdown.depth < 0 ? formatShortDate(report.maxDrawdown.troughDate, lang, "UTC") : undefined}
      />
      <StatTile label={k.effective} value={pending(quotesLoading, effective === null ? "—" : effective.toFixed(1))} sub={tpl(k.effectiveSub, { n: figures.positions })} />
    </div>
  );

  let body: ReactNode;
  if (quotesLoading || historyLoading) {
    body = <SkeletonRows rows={8} />;
  } else if (error && quotes.size === 0) {
    body = <ErrorState error={error} onRetry={refresh} />;
  } else if (history.error && !history.data) {
    body = <ErrorState error={history.error} title={t.port.historyError} onRetry={() => void history.mutate()} />;
  } else if (tab === "overview") {
    body = (
      <PerformanceTab
        report={report}
        benchmark={prefs.benchmark}
        range={prefs.range}
        onBenchmarkChange={(benchmark) => portViewStore.write({ ...prefs, benchmark })}
        onRangeChange={(range) => portViewStore.write({ ...prefs, range })}
        qqq={qqq.data}
        loading={prefs.benchmark === "QQQ" && !qqq.data && !qqq.error}
      />
    );
  } else if (tab === "exposure") {
    body = <ExposureTab portfolio={portfolio} quotes={quotes} infoOf={infoOf} fx={fx} />;
  } else if (tab === "risk") {
    body = <RiskTab report={report} quotes={quotes} positions={portfolio.rows.length} />;
  } else {
    body = <CorrelationTab report={report} />;
  }

  const shortHistory = !historyLoading && report.sessions > 0 && report.sessions < FULL_YEAR_SESSIONS && report.since !== null;
  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <h1 className="sr-only">{t.port.title}</h1>
      {tiles}
      <div className="bg-panel xl:col-span-2">
        <StaleBanner show={stale} since={staleSince} />
        <p className="px-3 py-2 text-xs text-fg-2">
          {t.port.basis}
          {shortHistory ? ` ${tpl(t.port.sessionsNote, { n: report.sessions, date: formatDate(report.since, lang, "UTC") })}` : ""}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <Panel title={t.port.analytics} code={tab === "correlation" ? "CORR" : "PORT"}>
          <div className="overflow-x-auto border-b border-line px-1">
            <Tabs
              label={t.port.tabs.label}
              value={tab}
              onChange={changeTab}
              size="md"
              options={[
                { value: "overview", label: t.port.tabs.overview },
                { value: "exposure", label: t.port.tabs.exposure },
                { value: "risk", label: t.port.tabs.risk },
                { value: "correlation", label: t.port.tabs.correlation },
              ]}
            />
          </div>
          {body}
        </Panel>
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <CoveragePanel portfolio={portfolio} report={report} beyond={selection.beyond.map((p) => p.symbol)} loading={historyLoading || quotesLoading} />
        <MethodPanel />
      </div>
    </div>
  );
}
