"use client";

import { useId } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useWorldMarkets } from "@/hooks/useMarketsApi";
import { formatTime, tpl } from "@/lib/format";
import { getWorldSymbol, type WorldRegion } from "@/lib/universe";
import type { WorldMarketsResponse } from "@/types/markets";

import { groupWorld, overnightSummary } from "./world";
import { WorldTable } from "./WorldTable";

const EQUITY_REGIONS: readonly WorldRegion[] = ["americas", "europe", "asia"];

/** "Overnight · Asia close NKY −5.96% HSI −1.27% · Europe live SX5E +0.30% …": how the other sessions went. */
export function OvernightLine({ data }: { data: WorldMarketsResponse }) {
  const { t } = usePrefs();
  const groups = overnightSummary(data.rows);
  if (groups.length === 0) return null;
  const label = (region: "asia" | "europe", live: boolean) =>
    region === "asia"
      ? live
        ? t.markets.overnightGroups.asiaLive
        : t.markets.overnightGroups.asiaClose
      : live
        ? t.markets.overnightGroups.europeLive
        : t.markets.overnightGroups.europeClose;
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 border-b border-line px-3 py-2 text-xs">
      <span className="col-head">{t.markets.overnight}</span>
      {groups.map((group) => (
        <span key={group.region} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-fg-2">{label(group.region, group.live)}</span>
          {group.items.map((item) => (
            <span key={item.symbol} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="mono text-fg-3">{item.code}</span>
              <Delta value={item.changePercent} />
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

function MissingNote({ data, regions }: { data: WorldMarketsResponse; regions: readonly WorldRegion[] }) {
  const { t } = usePrefs();
  const missing = data.missing.filter((symbol) => {
    const region = getWorldSymbol(symbol)?.region;
    return region !== undefined && regions.includes(region);
  });
  if (missing.length === 0) return null;
  const codes = missing.map((symbol) => getWorldSymbol(symbol)?.code ?? symbol).join(", ");
  return <p className="border-t border-line px-3 py-1.5 text-micro text-fg-3">{tpl(t.markets.missing, { symbols: codes })}</p>;
}

/** WEI: the world's equity benchmarks by region, with the overnight line on top. */
export function WorldPanel({ className }: { className?: string }) {
  const { t, lang } = usePrefs();
  const headingId = useId();
  const { data, error, mutate } = useWorldMarkets();
  const groups = data ? groupWorld(data.rows).filter((group) => EQUITY_REGIONS.includes(group.region)) : [];
  const now = data ? Date.parse(data.asOf) : 0;

  return (
    <Panel
      title={t.markets.world}
      code="WEI"
      className={className}
      actions={data ? <PanelMeta>{tpl(t.markets.asOfEt, { time: formatTime(data.asOf, lang, "America/New_York") })}</PanelMeta> : null}
    >
      <StaleBanner show={Boolean(error && data) || Boolean(data?.warnings.includes("quotes_stale"))} since={data?.asOf} />
      {data ? (
        <>
          <OvernightLine data={data} />
          {groups.map((group) => (
            <section key={group.region} aria-labelledby={`${headingId}-${group.region}`} className="border-b border-line last:border-b-0">
              <h3 id={`${headingId}-${group.region}`} className="col-head bg-panel-2 px-3 py-1.5">
                {t.markets.regions[group.region]}
              </h3>
              <WorldTable entries={group.entries} caption={t.markets.regions[group.region]} now={now} />
            </section>
          ))}
          <MissingNote data={data} regions={EQUITY_REGIONS} />
        </>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : (
        <SkeletonRows rows={14} />
      )}
    </Panel>
  );
}

/** A narrow panel for one non-equity region of the board: currencies, commodities or crypto. */
export function RegionPanel({ region, code, className }: { region: "fx" | "commodities" | "crypto"; code: string; className?: string }) {
  const { t } = usePrefs();
  const { data, error, mutate } = useWorldMarkets();
  const group = data ? groupWorld(data.rows).find((g) => g.region === region) : undefined;

  return (
    <Panel title={t.markets.regions[region]} code={code} className={className}>
      {data && group ? (
        <>
          <WorldTable entries={group.entries} caption={t.markets.regions[region]} compact now={Date.parse(data.asOf)} />
          <MissingNote data={data} regions={[region]} />
        </>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} compact />
      ) : (
        <SkeletonRows rows={region === "crypto" ? 2 : 5} />
      )}
    </Panel>
  );
}
