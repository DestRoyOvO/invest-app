// The distribution of today's moves across the heatmap's universe, for the breadth panel. Pure.

import { HEAT_STEPS, heatStep, type HeatStep } from "@/components/ui/delta-utils";
import type { SectorSnapshot } from "@/types/api";

export interface DistributionBin {
  step: HeatStep;
  count: number;
}

/** Stocks per heatmap step (strongly down to strongly up), so the bars share the heatmap's colors and bands. */
export function changeDistribution(sectors: readonly SectorSnapshot[]): DistributionBin[] {
  const counts = new Map<HeatStep, number>(HEAT_STEPS.map((step) => [step, 0]));
  for (const sector of sectors) {
    for (const quote of sector.stocks) {
      if (quote.changePercent === null) continue;
      const step = heatStep(quote.changePercent);
      counts.set(step, (counts.get(step) ?? 0) + 1);
    }
  }
  return HEAT_STEPS.map((step) => ({ step, count: counts.get(step) ?? 0 }));
}
