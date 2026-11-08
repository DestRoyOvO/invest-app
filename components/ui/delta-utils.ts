// Pure helpers behind Delta, the heatmap scale and direction-aware glyphs, kept free of React so they can be tested.

import { signOf } from "@/lib/format";

export type Direction = "up" | "down" | "flat";

/** Direction of a signed value such as a change or a P&L: "flat" for zero, null or not a number. */
export function directionOf(value: number | null | undefined): Direction {
  const sign = signOf(value);
  return sign > 0 ? "up" : sign < 0 ? "down" : "flat";
}

/**
 * The number a Delta shows, which its color and arrow follow: a percent or a ratio rounded to the decimals of its text
 * (formatPercent leaves the sign off a figure that rounds to zero, so "0.00%" is flat, not red), a price change as it is
 * (formatChange signs every change but zero). Null when there is no number.
 */
export function shownValue(value: number | null | undefined, kind: "percent" | "ratio" | "change", digits?: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (kind === "change") return value;
  const rounded = Number((kind === "ratio" ? value * 100 : value).toFixed(digits ?? 2));
  return rounded === 0 ? 0 : rounded;
}

/** Replaces a leading ASCII hyphen with U+2212, which is as wide as "+" in tabular figures and reads as "minus". */
export function withTrueMinus(text: string): string {
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
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
