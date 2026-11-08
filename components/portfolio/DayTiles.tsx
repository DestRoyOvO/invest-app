"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { StatTile } from "@/components/ui/StatTile";
import { TickNumber } from "@/components/ui/TickNumber";
import { formatNumber, tpl } from "@/lib/format";

import { dayLabel, extendedLabel, formatSessionDate, type DayFigures } from "./day-figures";
import { SignedMoney } from "./money";

/**
 * KPI tiles for the investor's own day: value, today (amount and value-weighted %), unrealized P&L, optionally the cost
 * basis, and the pre-market or after-hours P&L as a separate figure when a holding trades outside the session. While
 * the market has not traded today, the day tile says "Last session" and names that session's date.
 */
export function DayTiles({ figures, costBasis = false }: { figures: DayFigures; costBasis?: boolean }) {
  const { t, lang } = usePrefs();
  const money = (value: number) => formatNumber(value, 2, lang);
  const earlier = figures.sessionDate !== null;
  return (
    <>
      <StatTile
        label={tpl(t.watchlist.value, { currency: figures.currency })}
        value={<TickNumber value={figures.value}>{money(figures.value)}</TickNumber>}
        sub={tpl(t.watchlist.positionsCount, { n: figures.positions })}
      />
      <StatTile
        label={dayLabel(figures, t)}
        value={
          <TickNumber value={figures.dayPnl}>
            <SignedMoney value={figures.dayPnl} lang={lang} />
          </TickNumber>
        }
        delta={<Delta value={figures.dayRatio} kind="ratio" digits={2} />}
        sub={figures.sessionDate !== null ? formatSessionDate(figures.sessionDate, lang) : undefined}
      />
      <StatTile
        label={t.watchlist.unrealized}
        value={
          <TickNumber value={figures.pnl}>
            <SignedMoney value={figures.pnl} lang={lang} />
          </TickNumber>
        }
        delta={<Delta value={figures.pnlPct} kind="ratio" digits={1} />}
        sub={costBasis ? undefined : `${t.watchlist.costBasis} ${money(figures.costBasis)}`}
      />
      {costBasis ? <StatTile label={t.watchlist.costBasis} value={money(figures.costBasis)} /> : null}
      {figures.extended ? (
        <StatTile
          label={extendedLabel(figures.extended.session, t)}
          value={<SignedMoney value={figures.extended.pnl} lang={lang} />}
          delta={<Delta value={figures.extended.ratio} kind="ratio" digits={2} />}
          sub={earlier ? t.watchlist.notInLastSession : t.watchlist.notInToday}
        />
      ) : null}
    </>
  );
}
