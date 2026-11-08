import { cn } from "@/lib/cn";
import { formatChange, formatPercent, formatRatio, signOf } from "@/lib/format";
import type { Lang } from "@/types/api";

import { shownValue, withTrueMinus } from "./delta-utils";

export { directionOf, heatStep, heatStyle, HEAT_EDGES, HEAT_STEPS, withTrueMinus, type Direction, type HeatStep } from "./delta-utils";

interface DeltaProps {
  value: number | null | undefined;
  /** percent: value in percent units; ratio: decimal; change: absolute price change. */
  kind?: "percent" | "ratio" | "change";
  digits?: number;
  arrow?: boolean;
  lang?: Lang;
  className?: string;
}

/**
 * A signed price, return or P&L colored by direction (up/down follow the user's color convention), with a true minus
 * sign. Only for prices, returns and P&L: model readings, percentiles and risk use neutral text.
 */
export function Delta({ value, kind = "percent", digits, arrow = false, lang = "en", className }: DeltaProps) {
  const sign = signOf(shownValue(value, kind, digits));
  const color = sign > 0 ? "text-up" : sign < 0 ? "text-down" : "text-fg-3";
  const text =
    kind === "percent"
      ? formatPercent(value, { digits })
      : kind === "ratio"
        ? formatRatio(value, { digits: digits ?? 2, sign: true })
        : formatChange(value, lang);
  return (
    <span className={cn("num whitespace-nowrap", color, className)}>
      {arrow && sign !== 0 ? (
        <span aria-hidden className="mr-0.5 text-[0.7em]">
          {sign > 0 ? "▲" : "▼"}
        </span>
      ) : null}
      {withTrueMinus(text)}
    </span>
  );
}
