// Pure formatting for the correlation matrix, kept free of React so it can be tested.

import { withTrueMinus } from "@/components/ui/delta-utils";

/** Signed correlation with two decimals and a true minus. A value that rounds to zero prints 0.00, never −0.00. */
export function formatCorrelation(r: number): string {
  // Number("-0.00") is -0, and -0 || 0 is 0.
  const rounded = Number(r.toFixed(2)) || 0;
  return withTrueMinus(rounded.toFixed(2));
}

/**
 * Design-system color rule 6: a signed reading that is not a price shades by magnitude only, on one neutral ramp
 * (info mixed into the panel at |r| x 40%), and prints the signed number in --fg. Never red and green.
 */
export function correlationShade(r: number | null): string | undefined {
  if (r === null || !Number.isFinite(r)) return undefined;
  const n = Math.round(Math.min(1, Math.abs(r)) * 40);
  return `color-mix(in oklab, var(--info) ${n}%, var(--panel))`;
}
