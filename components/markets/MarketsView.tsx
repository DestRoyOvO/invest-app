"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";

import { BreadthPanel } from "./BreadthPanel";
import { RatesPanel } from "./RatesPanel";
import { RegionPanel, WorldPanel } from "./WorldPanels";

/**
 * World markets (WEI) and rates (GC): equity benchmarks by region with the overnight line and the breadth of the US
 * large caps on the left; the Treasury curve, currencies, commodities and crypto on the right. Column flow, so each
 * panel keeps its natural height; DOM order is the phone order.
 */
export function MarketsView() {
  const { t } = usePrefs();
  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <h1 className="sr-only">{t.markets.title}</h1>
      <div className="flex min-w-0 flex-col gap-px">
        <WorldPanel />
        <BreadthPanel />
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <RatesPanel />
        <RegionPanel region="fx" code="FX" />
        <RegionPanel region="commodities" code="CMDT" />
        <RegionPanel region="crypto" code="CRYP" />
      </div>
    </div>
  );
}
