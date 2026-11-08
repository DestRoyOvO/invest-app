import { cn } from "@/lib/cn";
import { formatChange, formatNumber, formatPercent, formatRatio, signOf } from "@/lib/format";
import type { Lang } from "@/types/api";

import { withTrueMinus } from "./delta-utils";

export { directionOf, heatStep, heatStyle, HEAT_EDGES, HEAT_STEPS, withTrueMinus, type Direction, type HeatStep } from "./delta-utils";

interface DeltaProps {
  value: number | null | undefined;
  /** percent: value in percent units; ratio: decimal; change: absolute price change. */
  kind?: "percent" | "ratio" | "change";
  /**
   * Decimals. A change takes the decimals of the price beside it (a currency pair's pips, see priceDigits in
   * lib/quote-figures.ts); without them it follows formatChange (2, or 4 for sub-cent moves).
   */
  digits?: number;
  arrow?: boolean;
  lang?: Lang;
  className?: string;
}

/** A signed price change with fixed decimals (USD/JPY +0.770), or formatChange's rule without them. */
function changeText(value: number | null | undefined, lang: Lang, digits: number | undefined): string {
  if (digits === undefined || typeof value !== "number" || !Number.isFinite(value)) return formatChange(value, lang);
  const text = formatNumber(Math.abs(value), digits, lang);
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

/**
 * A signed price, return or P&L colored by direction (up/down follow the user's color convention), with a true minus
 * sign. Only for prices, returns and P&L: model readings, percentiles and risk use neutral text.
 */
export function Delta({ value, kind = "percent", digits, arrow = false, lang = "en", className }: DeltaProps) {
  const sign = signOf(value);
  const color = sign > 0 ? "text-up" : sign < 0 ? "text-down" : "text-fg-3";
  const text =
    kind === "percent"
      ? formatPercent(value, { digits })
      : kind === "ratio"
        ? formatRatio(value, { digits: digits ?? 2, sign: true })
        : changeText(value, lang, digits);
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
