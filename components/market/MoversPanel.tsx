"use client";

import { useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Delta } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { ErrorState, StaleBanner } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { TickNumber } from "@/components/ui/TickNumber";
import { useDiscover } from "@/hooks/useApi";
import { useLocalString } from "@/hooks/useLocalValue";
import { stockPath } from "@/lib/api-client";
import { formatCompact, formatPrice, tpl } from "@/lib/format";
import { displayName } from "@/lib/names-zh";
import { UNIVERSE_STOCKS } from "@/lib/universe";
import { relativeVolume } from "@/lib/volume";
import type { DiscoverScreen, MarketOverview, OverviewQuote } from "@/types/api";

type MoverList = "gainers" | "losers" | "mostActive";
type Scope = "us" | "universe";

const SCREENS: Record<MoverList, DiscoverScreen> = { gainers: "day_gainers", losers: "day_losers", mostActive: "most_actives" };
const ROWS = 8;
const SCOPE_KEY = "investseek:movers:v1";

/**
 * Today's movers with a scope switch: the whole US market from Yahoo's screens (the default, quality-filtered on the
 * server) or the universe of large caps behind the heatmap. Relative volume shows how unusual the trading is.
 */
export function MoversPanel({ movers, loading, className }: { movers: MarketOverview["movers"] | undefined; loading: boolean; className?: string }) {
  const { t, lang } = usePrefs();
  const [storedScope, setScope] = useLocalString(SCOPE_KEY, "us");
  const scope: Scope = storedScope === "universe" ? "universe" : "us";
  const [list, setList] = useState<MoverList>("gainers");
  const discover = useDiscover(scope === "us" ? SCREENS[list] : null);
  const universeCount = UNIVERSE_STOCKS.length;

  // SWR keeps the previous key's data while the next loads: never show the gainers under the Losers tab.
  const usData = discover.data?.screen === SCREENS[list] ? discover.data : undefined;
  const rows: OverviewQuote[] = scope === "us" ? (usData?.quotes ?? []).slice(0, ROWS) : (movers?.[list] ?? []).slice(0, ROWS);
  const isLoading = scope === "us" ? !usData && !discover.error : loading;
  const failed = scope === "us" && discover.error && !usData;
  const title = scope === "us" ? t.markets.movers.titleUs : tpl(t.markets.movers.titleUniverse, { n: universeCount });
  const listLabel = list === "gainers" ? t.market.gainers : list === "losers" ? t.market.losers : t.market.mostActive;
  const caption = tpl(scope === "us" ? t.markets.movers.captionUs : t.markets.movers.captionUniverse, { list: listLabel, n: universeCount });

  const columns: DataTableColumn<OverviewQuote>[] = [
    { key: "symbol", header: t.columns.symbol, width: "4.75rem", render: (q) => <span className="mono font-medium text-fg">{q.symbol}</span> },
    { key: "name", header: t.columns.name, render: (q) => <span className="text-fg-2" title={q.name}>{displayName(q.symbol, q.name, lang)}</span> },
    {
      key: "last",
      header: t.columns.last,
      align: "right",
      width: "5.25rem",
      // Phones keep the name, which matters more for market-wide movers than the price.
      hideBelow: "sm",
      render: (q) => <TickNumber value={q.price}>{formatPrice(q.price, lang)}</TickNumber>,
    },
    { key: "chg", header: t.columns.changePct, align: "right", width: "5.25rem", render: (q) => <Delta value={q.changePercent} /> },
    {
      key: "relVol",
      header: t.markets.movers.relVol,
      title: t.markets.movers.relVolTitle,
      align: "right",
      width: "3.75rem",
      render: (q) => {
        const rel = relativeVolume(q.volume, q.avgVolume);
        return <span className="num text-fg-2">{rel === null ? "—" : `${rel.toFixed(1)}×`}</span>;
      },
    },
  ];

  const scopeControl = (phone: boolean) => (
    <Segmented
      label={t.markets.movers.scope}
      hideLabel
      size="sm"
      value={scope}
      onChange={(next) => setScope(next)}
      options={[
        { value: "us", label: t.markets.movers.us },
        { value: "universe", label: tpl(t.markets.movers.universe, { n: universeCount }) },
      ]}
      className={phone ? undefined : "w-44"}
    />
  );

  return (
    <Panel title={title} code="MOV" actions={<div className="hidden sm:block">{scopeControl(false)}</div>} className={className}>
      <div className="border-b border-line px-3 py-2 sm:hidden">{scopeControl(true)}</div>
      <Tabs
        label={t.market.movers}
        value={list}
        onChange={setList}
        options={[
          { value: "gainers", label: t.market.gainers },
          { value: "losers", label: t.market.losers },
          { value: "mostActive", label: t.market.mostActive },
        ]}
        className="border-b border-line px-1"
      />
      <StaleBanner show={scope === "us" && Boolean(discover.error && usData)} since={usData?.asOf} />
      {failed ? (
        <ErrorState error={discover.error} onRetry={() => discover.mutate()} compact />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(q) => q.symbol}
          caption={caption}
          rowHref={(q) => stockPath(q.symbol)}
          loading={isLoading}
          loadingRows={ROWS}
          empty={t.markets.movers.empty}
        />
      )}
      {scope === "us" && usData ? (
        <p className="border-t border-line px-3 py-1.5 text-micro text-fg-3">
          {tpl(t.markets.movers.usNote, { cap: tpl(t.markets.movers.dollars, { value: formatCompact(usData.minMarketCap, lang) }) })}
        </p>
      ) : null}
    </Panel>
  );
}
