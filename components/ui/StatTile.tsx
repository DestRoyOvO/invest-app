import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

interface StatTileProps {
  /** Short label, rendered as a column head (11px caps). It also names the tile. */
  label: ReactNode;
  /** The figure, formatted by the caller (wrap live values in TickNumber). */
  value: ReactNode;
  /** Optional change beside the figure, usually a Delta. */
  delta?: ReactNode;
  /** Optional quiet line under the figure, e.g. "vs SPY +0.4%" or "cost basis 24,000". */
  sub?: ReactNode;
  /** md: 20px figure for KPI strips; lg: 30px for the one headline number of a view. */
  size?: "md" | "lg";
  className?: string;
}

/**
 * One KPI: label, figure, optional delta and sub-line. A group named by its label, so assistive technology announces
 * which figure it is entering and a tile can be found by its name. Lay several out as a strip with
 * `grid grid-cols-2 gap-px bg-line sm:grid-cols-4` so the gaps draw the rules.
 */
export function StatTile({ label, value, delta, sub, size = "md", className }: StatTileProps) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={cn("min-w-0 bg-panel px-3 py-2.5", className)}>
      <div id={labelId} className="col-head truncate">
        {label}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className={cn("num truncate text-fg", size === "lg" ? "text-display font-medium" : "text-figure")}>{value}</span>
        {delta ? <span className="text-data">{delta}</span> : null}
      </div>
      {sub ? <div className="mt-0.5 truncate text-micro text-fg-3">{sub}</div> : null}
    </div>
  );
}
