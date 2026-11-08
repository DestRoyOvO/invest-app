"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta, deltaParts } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/States";
import { StatTile } from "@/components/ui/StatTile";
import { cn } from "@/lib/cn";
import { formatRatio, tpl } from "@/lib/format";
import { UNIVERSE_STOCKS } from "@/lib/universe";
import type { BreadthTally, MarketBreadth } from "@/types/api";

import { sharePercent } from "./metrics";

/** "56%" for a tally, or a dash without data. */
export function TallyPercent({ tally }: { tally: BreadthTally }) {
  const share = sharePercent(tally.count, tally.of);
  return <>{share === null ? "—" : `${share}%`}</>;
}

/** Advancers against decliners as one bar: up on the left, down on the right, unchanged in between. Decorative. */
export function AdvanceDeclineBar({ breadth, className }: { breadth: Pick<MarketBreadth, "advancers" | "decliners" | "unchanged">; className?: string }) {
  const total = breadth.advancers + breadth.decliners + breadth.unchanged;
  if (total === 0) return <span aria-hidden className={cn("block h-1.5 bg-line-2", className)} />;
  return (
    <span aria-hidden className={cn("flex h-1.5 gap-px bg-panel", className)}>
      <span className="bg-up" style={{ width: `${(breadth.advancers / total) * 100}%` }} />
      {breadth.unchanged > 0 ? <span className="bg-line-2" style={{ width: `${(breadth.unchanged / total) * 100}%` }} /> : null}
      <span className="bg-down" style={{ width: `${(breadth.decliners / total) * 100}%` }} />
    </span>
  );
}

/** Equal-weight minus cap-weighted S&P 500 change, in percentage points, colored as the return gap it is (flat when it prints as zero). */
export function WeightGap({ breadth }: { breadth: Pick<MarketBreadth, "equalWeight" | "capWeight"> }) {
  const { t, lang } = usePrefs();
  const { equalWeight, capWeight } = breadth;
  const gap = equalWeight !== null && capWeight !== null ? equalWeight - capWeight : null;
  const { text, sign } = deltaParts(gap, "change", undefined, lang);
  return (
    <span className={cn("num", sign > 0 ? "text-up" : sign < 0 ? "text-down" : "text-fg-3")}>
      {gap === null ? "—" : tpl(t.markets.breadth.points, { value: text })}
    </span>
  );
}

function Tile({ label, value, sub, className }: { label: string; value: ReactNode; sub: ReactNode; className?: string }) {
  return <StatTile label={label} value={value} sub={sub} className={className} />;
}

/**
 * The five breadth tiles, laid out by the width of their container (wrap the grid in an `@container`): two across with
 * the last one full width, three over two from 36rem, and five across only from 56rem, where every tile has room for
 * its label and figure in both languages.
 */
export const BREADTH_GRID = "grid grid-cols-2 gap-px bg-line @xl:grid-cols-6 @4xl:grid-cols-5";
export const BREADTH_TILE = [
  "@xl:col-span-2 @4xl:col-span-1",
  "@xl:col-span-2 @4xl:col-span-1",
  "@xl:col-span-2 @4xl:col-span-1",
  "@xl:col-span-3 @4xl:col-span-1",
  "col-span-2 @xl:col-span-3 @4xl:col-span-1",
] as const;

/** RSP and SPY with today's change; wraps onto two lines rather than cutting off a number. */
export function WeightPair({ breadth }: { breadth: Pick<MarketBreadth, "equalWeight" | "capWeight"> }) {
  return (
    <span className="flex flex-wrap gap-x-2">
      <span className="whitespace-nowrap">
        RSP <Delta value={breadth.equalWeight} />
      </span>
      <span className="whitespace-nowrap">
        SPY <Delta value={breadth.capWeight} />
      </span>
    </span>
  );
}

/**
 * The overview's breadth strip over the heatmap's universe: the share above the 50- and 200-day averages, advancers
 * against decliners, stocks near a 52-week high or low, and the equal-weight S&P 500 against the cap-weighted one.
 */
export function BreadthStrip({ breadth, loading, className }: { breadth: MarketBreadth | null | undefined; loading: boolean; className?: string }) {
  const { t } = usePrefs();
  const n = UNIVERSE_STOCKS.length;
  return (
    <Panel
      title={tpl(t.markets.breadth.title, { n })}
      code="BRTH"
      className={className}
      actions={
        <Link href="/markets#breadth" className="flex items-center gap-1 text-xs text-fg-3 transition-colors hover:text-fg max-sm:min-h-10">
          {t.markets.breadth.details}
          <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.75} />
        </Link>
      }
    >
      {breadth ? (
        <div className="@container">
          <div className={BREADTH_GRID}>
            <Tile
              label={t.markets.breadth.above50}
              value={<TallyPercent tally={breadth.above50d} />}
              sub={tpl(t.markets.breadth.ofStocks, { count: breadth.above50d.count, of: breadth.above50d.of })}
              className={BREADTH_TILE[0]}
            />
            <Tile
              label={t.markets.breadth.above200}
              value={<TallyPercent tally={breadth.above200d} />}
              sub={tpl(t.markets.breadth.ofStocks, { count: breadth.above200d.count, of: breadth.above200d.of })}
              className={BREADTH_TILE[1]}
            />
            <Tile
              label={t.markets.breadth.advDec}
              value={`${breadth.advancers} / ${breadth.decliners}`}
              sub={<AdvanceDeclineBar breadth={breadth} className="mt-1.5" />}
              className={BREADTH_TILE[2]}
            />
            <Tile
              label={t.markets.breadth.highsLows}
              value={`${breadth.nearHigh.count} / ${breadth.nearLow.count}`}
              sub={tpl(t.markets.breadth.within, { pct: formatRatio(breadth.nearExtreme, { digits: 0 }) })}
              className={BREADTH_TILE[3]}
            />
            <Tile label={t.markets.breadth.equalVsCap} value={<WeightGap breadth={breadth} />} sub={<WeightPair breadth={breadth} />} className={BREADTH_TILE[4]} />
          </div>
        </div>
      ) : loading ? (
        <div className="@container">
          <div className={BREADTH_GRID}>
            {BREADTH_TILE.map((span, i) => (
              <div key={i} className={cn("space-y-2 bg-panel px-3 py-2.5", span)}>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-14" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="px-3 py-3 text-sm text-fg-2">{t.markets.breadth.unavailable}</p>
      )}
    </Panel>
  );
}
