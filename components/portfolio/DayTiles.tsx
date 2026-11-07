"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { StatTile } from "@/components/ui/StatTile";
import { TickNumber } from "@/components/ui/TickNumber";
import { formatNumber, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { dayChangeRatio, extendedHoursPnl, type ExtendedHoursPnl, type Portfolio } from "@/lib/portfolio";
import type { Quote } from "@/types/api";

import { SignedMoney } from "./money";

export interface DayFigures {
  currency: string;
  value: number;
  dayPnl: number;
  /** Value-weighted: dayPnl / (value - dayPnl). */
  dayRatio: number | null;
  pnl: number;
  pnlPct: number | null;
  costBasis: number;
  positions: number;
  /** Pre-market or after-hours P&L, never part of dayPnl. */
  extended: ExtendedHoursPnl | null;
}

/** The headline figures of the base-currency positions. */
export function dayFigures(portfolio: Portfolio, quotes: ReadonlyMap<string, Quote>): DayFigures {
  const { totals, rows, baseCurrency } = portfolio;
  return {
    currency: baseCurrency,
    value: totals.value,
    dayPnl: totals.dayPnl,
    dayRatio: dayChangeRatio(rows),
    pnl: totals.pnl,
    pnlPct: totals.pnlPct,
    costBasis: totals.costBasis,
    positions: rows.length,
    extended: extendedHoursPnl(rows, (symbol) => quotes.get(symbol)),
  };
}

export function extendedLabel(session: ExtendedHoursPnl["session"], t: Messages): string {
  return session === "PRE" ? t.watchlist.preMarketPnl : session === "POST" ? t.watchlist.afterHoursPnl : t.watchlist.extendedPnl;
}

/** How many tiles DayTiles renders, so the parent grid can size its columns without empty cells. */
export function dayTileCount(figures: DayFigures, costBasis: boolean): number {
  return 3 + (costBasis ? 1 : 0) + (figures.extended ? 1 : 0);
}

/**
 * KPI tiles for the investor's own day: value, today (amount and value-weighted %), unrealized P&L, optionally the cost
 * basis, and the pre-market or after-hours P&L as a separate figure when a holding trades outside the session.
 */
export function DayTiles({ figures, costBasis = false }: { figures: DayFigures; costBasis?: boolean }) {
  const { t, lang } = usePrefs();
  const money = (value: number) => formatNumber(value, 2, lang);
  return (
    <>
      <StatTile
        label={tpl(t.watchlist.value, { currency: figures.currency })}
        value={<TickNumber value={figures.value}>{money(figures.value)}</TickNumber>}
        sub={tpl(t.watchlist.positionsCount, { n: figures.positions })}
      />
      <StatTile
        label={t.watchlist.today}
        value={
          <TickNumber value={figures.dayPnl}>
            <SignedMoney value={figures.dayPnl} lang={lang} />
          </TickNumber>
        }
        delta={<Delta value={figures.dayRatio} kind="ratio" digits={2} />}
      />
      <StatTile
        label={t.watchlist.unrealized}
        value={<SignedMoney value={figures.pnl} lang={lang} />}
        delta={<Delta value={figures.pnlPct} kind="ratio" digits={1} />}
        sub={costBasis ? undefined : `${t.watchlist.costBasis} ${money(figures.costBasis)}`}
      />
      {costBasis ? <StatTile label={t.watchlist.costBasis} value={money(figures.costBasis)} /> : null}
      {figures.extended ? (
        <StatTile
          label={extendedLabel(figures.extended.session, t)}
          value={<SignedMoney value={figures.extended.pnl} lang={lang} />}
          delta={<Delta value={figures.extended.ratio} kind="ratio" digits={2} />}
          sub={t.watchlist.notInToday}
        />
      ) : null}
    </>
  );
}
