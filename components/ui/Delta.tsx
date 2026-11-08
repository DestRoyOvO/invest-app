import { cn } from "@/lib/cn";
import type { Lang } from "@/types/api";

import { deltaParts, type DeltaKind } from "./delta-utils";

export { deltaParts, directionOf, heatStep, heatStyle, HEAT_EDGES, HEAT_STEPS, withTrueMinus, type DeltaKind, type Direction, type HeatStep } from "./delta-utils";

interface DeltaProps {
  value: number | null | undefined;
  /** percent: value in percent units; ratio: decimal; change: absolute price change. */
  kind?: DeltaKind;
  /**
   * Decimals. A change takes the decimals of the price beside it (a currency pair's pips, see priceDigits in
   * lib/quote-figures.ts); without them it follows formatChange (2, or 4 for sub-cent moves).
   */
  digits?: number;
  arrow?: boolean;
  lang?: Lang;
  className?: string;
}

/**
 * A signed price, return or P&L colored by direction (up/down follow the user's color convention), with a true minus
 * sign. The color and the arrow follow the printed number (deltaParts): a move that rounds to zero at the shown
 * decimals prints "0.00%" in the flat tone, without an arrow. Only for prices, returns and P&L: model readings,
 * percentiles and risk use neutral text.
 */
export function Delta({ value, kind = "percent", digits, arrow = false, lang = "en", className }: DeltaProps) {
  const { text, sign } = deltaParts(value, kind, digits, lang);
  const color = sign > 0 ? "text-up" : sign < 0 ? "text-down" : "text-fg-3";
  return (
    <span className={cn("num whitespace-nowrap", color, className)}>
      {arrow && sign !== 0 ? (
        <span aria-hidden className="mr-0.5 text-[0.7em]">
          {sign > 0 ? "▲" : "▼"}
        </span>
      ) : null}
      {text}
    </span>
  );
}
