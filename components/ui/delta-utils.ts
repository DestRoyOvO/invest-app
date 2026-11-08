// Pure helpers behind Delta, the heatmap scale and direction-aware glyphs, kept free of React so they can be tested.

import { changeDigits, DASH, displayedSign, formatPercent, formatRatio, formatSigned } from "@/lib/format";
import type { Lang } from "@/types/api";

export type Direction = "up" | "down" | "flat";

/**
 * Direction of a signed value such as a change or a P&L, as printed with `digits` decimals (2, as Delta prints a
 * percent): "flat" when it rounds to zero there and for null or not a number, so a sparkline's tone agrees with the
 * change printed beside it.
 */
export function directionOf(value: number | null | undefined, digits = 2): Direction {
  const sign = displayedSign(value, digits);
  return sign > 0 ? "up" : sign < 0 ? "down" : "flat";
}

/** Replaces a leading ASCII hyphen with U+2212, which is as wide as "+" in tabular figures and reads as "minus". */
export function withTrueMinus(text: string): string {
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
}

/** percent: percent units; ratio: a decimal shown as a percent; change: an absolute price change or amount. */
export type DeltaKind = "percent" | "ratio" | "change";

/**
 * A signed change, return or P&L as Delta prints it (with a true minus) and the sign of the printed number, which its
 * color and arrow follow: a move that rounds to zero at the shown decimals prints unsigned ("0.00%") and is flat, never
 * a red "−0.00%". Decimals: `digits`, or 2 for a percent or a ratio and formatChange's rule for a change (2, or 4 for a
 * sub-cent move).
 */
export function deltaParts(value: number | null | undefined, kind: DeltaKind, digits?: number, lang: Lang = "en"): { text: string; sign: -1 | 0 | 1 } {
  if (typeof value !== "number" || !Number.isFinite(value)) return { text: DASH, sign: 0 };
  if (kind === "percent") {
    const shown = digits ?? 2;
    return { text: withTrueMinus(formatPercent(value, { digits: shown })), sign: displayedSign(value, shown) };
  }
  if (kind === "ratio") {
    const shown = digits ?? 2;
    return { text: withTrueMinus(formatRatio(value, { digits: shown, sign: true })), sign: displayedSign(value * 100, shown) };
  }
  const shown = digits ?? changeDigits(value);
  return { text: withTrueMinus(formatSigned(value, shown, lang)), sign: displayedSign(value, shown) };
}

/** Heatmap step edges in percent: a move below the first edge is flat. */
export const HEAT_EDGES = [0.1, 0.75, 1.75, 3.5] as const;

export type HeatStep = -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4;

export const HEAT_STEPS: readonly HeatStep[] = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

/**
 * Heatmap step for a change in percent units: 0 below 0.10%, then 1 to 4 (signed) from 0.10, 0.75, 1.75 and 3.5%.
 * Steps hide small differences inside a bucket on purpose; hover cards carry the exact number. Missing values are flat.
 */
export function heatStep(changePercent: number | null | undefined): HeatStep {
  if (typeof changePercent !== "number" || !Number.isFinite(changePercent)) return 0;
  const abs = Math.abs(changePercent);
  const size = HEAT_EDGES.filter((edge) => abs >= edge).length;
  if (size === 0) return 0;
  return (changePercent < 0 ? -size : size) as HeatStep;
}

/** Fill and text color for a heatmap step. The semantic tokens follow the theme and the price convention. */
export function heatStyle(step: HeatStep): { background: string; color: string } {
  if (step === 0) return { background: "var(--heat-flat)", color: "var(--heat-fg)" };
  const side = step > 0 ? "up" : "down";
  const size = Math.abs(step);
  return { background: `var(--heat-${side}-${size})`, color: size === 4 ? "var(--heat-fg-strong)" : "var(--heat-fg)" };
}
