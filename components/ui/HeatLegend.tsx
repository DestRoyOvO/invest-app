import { cn } from "@/lib/cn";

import { HEAT_EDGES, HEAT_STEPS, heatStyle, withTrueMinus } from "./delta-utils";

/**
 * Nine-swatch legend for the heatmap scale (-3.5% ... +3.5%), 12x8 swatches with 11px numbers. The swatches follow the
 * theme and price convention; the numbers carry the meaning for screen readers.
 */
export function HeatLegend({ className }: { className?: string }) {
  const outer = HEAT_EDGES[HEAT_EDGES.length - 1];
  return (
    <span className={cn("num inline-flex items-center gap-1.5 text-micro text-fg-3", className)}>
      <span>{withTrueMinus(`-${outer}`)}</span>
      <span aria-hidden className="inline-flex gap-px">
        {HEAT_STEPS.map((step) => (
          <span key={step} className="inline-block h-2 w-3" style={{ background: heatStyle(step).background }} />
        ))}
      </span>
      <span>+{outer}%</span>
    </span>
  );
}
