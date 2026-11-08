"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Button } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { usePortfolio, useNow } from "@/hooks/usePortfolio";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatShortDate, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { dayMovers, nextEarnings, type ValuedPosition } from "@/lib/portfolio";
import type { Lang, Quote } from "@/types/api";

import { dayFigures, dayTileCount } from "./day-figures";
import { DayTiles } from "./DayTiles";
import { SignedMoney } from "./money";

/** Secondary button look for a link (the design system's Button renders a <button>). */
export const LINK_BUTTON =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-xs border border-line-2 bg-panel-2 px-2 text-xs font-medium whitespace-nowrap text-fg transition-colors hover:bg-hover max-sm:h-10 max-sm:px-3";

function MoverList({ title, rows, quotes, lang, empty }: { title: string; rows: ValuedPosition[]; quotes: ReadonlyMap<string, Quote>; lang: Lang; empty: string }) {
  return (
    <div className="min-w-0 bg-panel px-3 py-2.5">
      <h3 className="col-head">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1.5 text-xs text-fg-3">{empty}</p>
      ) : (
        <ul className="mt-1">
          {rows.map((row) => (
            <li key={row.symbol} className="flex h-7 items-center gap-3 text-data max-sm:h-10">
              <Link href={stockPath(row.symbol)} className="mono w-16 shrink-0 font-medium text-fg hover:text-accent max-sm:inline-flex max-sm:h-10 max-sm:items-center">
                {row.symbol}
              </Link>
              <SignedMoney value={row.dayPnl} lang={lang} className="ml-auto" />
              <Delta value={quotes.get(row.symbol)?.changePercent} className="w-16 text-right text-xs" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function earningsWhen(days: number, t: Messages): string {
  return days === 0 ? t.port.myDay.today2 : days === 1 ? t.port.myDay.tomorrow : tpl(t.port.myDay.inDays, { n: days });
}

/**
 * The investor's own day, first on the overview: value, today's P&L (value-weighted %), unrealized P&L, the
 * pre-market or after-hours P&L when a holding trades outside the session, the largest contributors and detractors
 * in money, and the next report among the holdings. A first-run prompt when no positions are stored.
 */
export function MyDayPanel({ className }: { className?: string }) {
  const { t, lang } = usePrefs();
  const { openCommand } = useUi();
  const { holdings, portfolio, quotes, hydrated, loading, error, stale, staleSince, refresh } = usePortfolio();
  const now = useNow();
  const held = Object.keys(holdings);
  const figures = dayFigures(portfolio, quotes, now);
  const tiles = dayTileCount(figures, false);
  const { contributors, detractors } = dayMovers(portfolio.rows);
  const upcoming = now > 0 ? nextEarnings(held, (s) => quotes.get(s), now) : null;
  const m = t.port.myDay;

  let body;
  if (!hydrated) {
    body = <SkeletonRows rows={3} />;
  } else if (held.length === 0) {
    body = (
      <EmptyState
        actions={
          <>
            <Button size="sm" onClick={openCommand}>
              {m.addTickers}
            </Button>
            <Link href="/data#paste" className={LINK_BUTTON}>
              {m.pastePositions}
            </Link>
          </>
        }
      >
        {m.firstRun}
      </EmptyState>
    );
  } else if (loading) {
    body = <SkeletonRows rows={4} />;
  } else if (error && quotes.size === 0) {
    body = <ErrorState error={error} onRetry={refresh} compact />;
  } else {
    body = (
      <>
        <StaleBanner show={stale} since={staleSince} />
        {/* Two columns on phones: an odd last tile spans both, so no empty cell is left. */}
        <div
          className={cn(
            "grid grid-cols-2 gap-px bg-line [&>*:last-child:nth-child(odd)]:max-sm:col-span-2",
            tiles >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3",
          )}
        >
          <DayTiles figures={figures} />
        </div>
        <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
          <MoverList title={m.contributors} rows={contributors} quotes={quotes} lang={lang} empty={m.noMovers} />
          <MoverList title={m.detractors} rows={detractors} quotes={quotes} lang={lang} empty={m.noMovers} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs">
          <p className="min-w-0 text-fg-2">
            {upcoming ? (
              <>
                {tpl(m.nextEarnings, { symbol: upcoming.symbol, date: formatShortDate(upcoming.date, lang, "America/New_York") })}
                <span className="text-fg-3">
                  {" · "}
                  {earningsWhen(upcoming.days, t)}
                  {upcoming.estimated ? ` · ${t.watchlist.est}` : ""}
                </span>
              </>
            ) : (
              <span className="text-fg-3">{m.noEarnings}</span>
            )}
          </p>
          <Link href="/portfolio" className="inline-flex items-center gap-1 text-fg-2 hover:text-fg max-sm:min-h-10">
            {m.analytics}
            <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.75} />
          </Link>
        </div>
        {portfolio.foreign.length > 0 ? <p className="border-t border-line px-3 py-2 text-xs text-fg-3">{tpl(t.portfolio.foreignNote, { currency: portfolio.baseCurrency })}</p> : null}
      </>
    );
  }

  return (
    <Panel title={m.title} code="PORT" className={className}>
      {body}
    </Panel>
  );
}
