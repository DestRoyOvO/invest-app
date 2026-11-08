"use client";

import type { ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { AdvanceDeclineBar, BREADTH_GRID, BREADTH_TILE, TallyPercent, WeightGap, WeightPair } from "@/components/market/BreadthStrip";
import { sharePercent, staleSinceOf } from "@/components/market/metrics";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { HEAT_EDGES, heatStyle, type HeatStep } from "@/components/ui/Delta";
import { Meter } from "@/components/ui/Meter";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { ErrorState, Skeleton, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useOverview } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { formatRatio, formatTime, tpl } from "@/lib/format";
import { plural } from "@/lib/i18n/plural";
import { getSector, SECTORS, UNIVERSE_STOCKS } from "@/lib/universe";
import type { BreadthTally, MarketBreadth, SectorBreadth, SectorSnapshot } from "@/types/api";

import { changeDistribution } from "./breadth";

const BAND_KEYS: Record<HeatStep, "downStrong" | "down3" | "down2" | "down1" | "flat" | "up1" | "up2" | "up3" | "upStrong"> = {
  [-4]: "downStrong",
  [-3]: "down3",
  [-2]: "down2",
  [-1]: "down1",
  0: "flat",
  1: "up1",
  2: "up2",
  3: "up3",
  4: "upStrong",
};

/** Edges between the nine bars, in percent: −3.5 … −0.1, +0.1 … +3.5. */
const EDGES = [...[...HEAT_EDGES].reverse().map((edge) => -edge), ...HEAT_EDGES];

function edgeLabel(edge: number): string {
  return edge > 0 ? `+${edge}` : `−${Math.abs(edge)}`;
}

function TallyMeter({ tally, label, className }: { tally: BreadthTally; label: string; className?: string }) {
  const share = sharePercent(tally.count, tally.of);
  return <Meter value={share} label={label} valueText={share === null ? undefined : `${share}%`} className={className} />;
}

function SummaryTile({ label, value, children, className }: { label: string; value: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 bg-panel px-3 py-2.5", className)}>
      <div className="col-head truncate">{label}</div>
      <div className="num mt-1 text-figure text-fg">{value}</div>
      {children ? <div className="mt-1.5 text-micro text-fg-3">{children}</div> : null}
    </div>
  );
}

/** Today's moves across the universe as nine bars on the heatmap's bands and colors. */
function Distribution({ sectors }: { sectors: SectorSnapshot[] }) {
  const { t } = usePrefs();
  const bins = changeDistribution(sectors);
  const max = Math.max(1, ...bins.map((bin) => bin.count));
  return (
    <section aria-label={t.markets.breadth.distribution} className="border-t border-line px-3 pt-2.5 pb-3">
      <h3 className="col-head">{t.markets.breadth.distribution}</h3>
      <ul className="mt-2 grid h-24 grid-cols-9 items-end gap-1">
        {bins.map((bin) => (
          <li key={bin.step} className="flex h-full flex-col items-center justify-end gap-1">
            <span className="sr-only">{plural(t.markets.breadth.distributionLabel, bin.count, { band: t.markets.breadth.bands[BAND_KEYS[bin.step]] })}</span>
            <span aria-hidden className="num text-micro text-fg-2">
              {bin.count}
            </span>
            <span
              aria-hidden
              className="w-full rounded-t-[1px]"
              style={{ height: bin.count > 0 ? `${Math.max((bin.count / max) * 64, 3)}px` : "1px", background: bin.count > 0 ? heatStyle(bin.step).background : "var(--line-2)" }}
            />
          </li>
        ))}
      </ul>
      <div aria-hidden className="relative mt-1 h-4 border-t border-line-2">
        {EDGES.map((edge, i) => (
          <span key={edge} className="num absolute top-0.5 -translate-x-1/2 text-micro text-fg-3" style={{ left: `${((i + 1) / 9) * 100}%` }}>
            {edgeLabel(edge)}
          </span>
        ))}
      </div>
    </section>
  );
}

function SectorTable({ breadth }: { breadth: MarketBreadth }) {
  const { t, lang } = usePrefs();
  const meterCell = (tally: BreadthTally, label: string) => {
    const share = sharePercent(tally.count, tally.of);
    return (
      <span className="flex items-center justify-end gap-2">
        <TallyMeter tally={tally} label={label} className="w-12 min-w-0 max-sm:hidden" />
        <span className="num w-9 text-right text-fg">{share === null ? "—" : `${share}%`}</span>
      </span>
    );
  };
  const columns: DataTableColumn<SectorBreadth>[] = [
    {
      key: "sector",
      header: t.markets.breadth.sector,
      render: (row) => {
        const def = getSector(row.key);
        return (
          <span className="text-fg-2" title={def?.label[lang]}>
            <span className="max-sm:hidden">{def?.label[lang] ?? row.key}</span>
            <span className="sm:hidden">{def?.short[lang] ?? row.key}</span>
          </span>
        );
      },
      sortValue: (row) => getSector(row.key)?.label[lang] ?? row.key,
    },
    {
      key: "upDown",
      header: t.markets.breadth.upDownCol,
      align: "right",
      width: "var(--breadth-ud)",
      render: (row) => (
        <span className="num text-fg">
          {row.advancers} / {row.decliners}
        </span>
      ),
      sortValue: (row) => row.advancers - row.decliners,
    },
    {
      key: "above50",
      header: t.markets.breadth.above50Col,
      align: "right",
      width: "var(--breadth-pct)",
      render: (row) => meterCell(row.above50d, `${getSector(row.key)?.label[lang]}: ${t.markets.breadth.above50}`),
      sortValue: (row) => sharePercent(row.above50d.count, row.above50d.of),
    },
    {
      key: "above200",
      header: t.markets.breadth.above200Col,
      align: "right",
      width: "var(--breadth-pct)",
      render: (row) => meterCell(row.above200d, `${getSector(row.key)?.label[lang]}: ${t.markets.breadth.above200}`),
      sortValue: (row) => sharePercent(row.above200d.count, row.above200d.of),
    },
  ];
  return (
    <section aria-label={t.markets.breadth.bySector} className="border-t border-line">
      <h3 className="col-head px-3 pt-2.5 pb-1">{t.markets.breadth.bySector}</h3>
      {/* Column widths step up from sm, where the meters appear; phones keep room for the sector names. */}
      <div className="[--breadth-pct:5.25rem] [--breadth-ud:5.5rem] sm:[--breadth-pct:7.25rem] sm:[--breadth-ud:6.25rem]">
        <DataTable rows={breadth.sectors} columns={columns} rowKey={(row) => row.key} caption={t.markets.breadth.bySectorCaption} rowHref={(row) => `/sector/${row.key}`} />
      </div>
    </section>
  );
}

/** The full breadth view on the world markets page: summary, the distribution of today's moves and breadth by sector. */
export function BreadthPanel({ className }: { className?: string }) {
  const { t, lang } = usePrefs();
  const { data, error, mutate } = useOverview();
  const breadth = data?.breadth ?? null;
  const n = UNIVERSE_STOCKS.length;

  return (
    <Panel
      id="breadth"
      title={tpl(t.markets.breadth.title, { n })}
      code="BRTH"
      className={cn("scroll-mt-2", className)}
      actions={data ? <PanelMeta>{tpl(t.markets.asOfEt, { time: formatTime(data.asOf, lang, "America/New_York") })}</PanelMeta> : null}
    >
      <StaleBanner show={Boolean(error && data) || Boolean(data?.warnings.includes("quotes_stale"))} since={staleSinceOf(data)} />
      {breadth && data ? (
        <>
          <div className="@container">
            <div className={BREADTH_GRID}>
              <SummaryTile label={t.markets.breadth.above50} value={<TallyPercent tally={breadth.above50d} />} className={BREADTH_TILE[0]}>
                <TallyMeter tally={breadth.above50d} label={t.markets.breadth.above50} />
                <div className="mt-1.5">{tpl(t.markets.breadth.ofStocks, { count: breadth.above50d.count, of: breadth.above50d.of })}</div>
              </SummaryTile>
              <SummaryTile label={t.markets.breadth.above200} value={<TallyPercent tally={breadth.above200d} />} className={BREADTH_TILE[1]}>
                <TallyMeter tally={breadth.above200d} label={t.markets.breadth.above200} />
                <div className="mt-1.5">{tpl(t.markets.breadth.ofStocks, { count: breadth.above200d.count, of: breadth.above200d.of })}</div>
              </SummaryTile>
              <SummaryTile label={t.markets.breadth.advDec} value={`${breadth.advancers} / ${breadth.decliners}`} className={BREADTH_TILE[2]}>
                <AdvanceDeclineBar breadth={breadth} />
                <div className="mt-1.5">{tpl(t.markets.breadth.unchanged, { n: breadth.unchanged })}</div>
              </SummaryTile>
              <SummaryTile label={t.markets.breadth.highsLows} value={`${breadth.nearHigh.count} / ${breadth.nearLow.count}`} className={BREADTH_TILE[3]}>
                {tpl(t.markets.breadth.within, { pct: formatRatio(breadth.nearExtreme, { digits: 0 }) })}
              </SummaryTile>
              <SummaryTile label={t.markets.breadth.equalVsCap} value={<WeightGap breadth={breadth} />} className={BREADTH_TILE[4]}>
                <WeightPair breadth={breadth} />
              </SummaryTile>
            </div>
          </div>
          <Distribution sectors={data.sectors} />
          <SectorTable breadth={breadth} />
          <p className="border-t border-line px-3 py-1.5 text-micro text-fg-3">{tpl(t.markets.breadth.note, { n })}</p>
        </>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : data ? (
        <p className="px-3 py-3 text-sm text-fg-2">{t.markets.breadth.unavailable}</p>
      ) : (
        // Shaped like the loaded panel (the tiles, the distribution and the sector table), so the page keeps its length
        // while the data loads and a link to #breadth lands where the panel will be.
        <div aria-busy="true">
          <div className="@container">
            <div className={BREADTH_GRID}>
              {BREADTH_TILE.map((span, i) => (
                <div key={i} className={cn("space-y-2 bg-panel px-3 py-2.5", span)}>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-1.5 w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2 border-t border-line p-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-[7.5rem]" />
          </div>
          <SkeletonRows rows={SECTORS.length + 4} className="border-t border-line" />
        </div>
      )}
    </Panel>
  );
}
