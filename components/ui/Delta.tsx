import { cn } from "@/lib/cn";
import { formatChange, formatPercent, formatRatio, signOf } from "@/lib/format";
import type { Lang } from "@/types/api";

interface DeltaProps {
  value: number | null | undefined;
  /** percent: value in percent units; ratio: decimal; change: absolute price change. */
  kind?: "percent" | "ratio" | "change";
  digits?: number;
  arrow?: boolean;
  lang?: Lang;
  className?: string;
}

/** A signed number colored by direction (up/down colors follow the user's color convention). */
export function Delta({ value, kind = "percent", digits, arrow = false, lang = "en", className }: DeltaProps) {
  const sign = signOf(value);
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
      {text}
    </span>
  );
}

/**
 * Background tint for a change value, used by heatmaps and badges. `maxMix` caps how far the tint moves toward the
 * up/down color: the dark theme keeps it near 50% so light tile text stays above 4.5:1 contrast.
 */
export function deltaTint(value: number | null | undefined, maxAbs = 3, maxMix = 80): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "var(--heat-neutral)";
  const strength = Math.min(Math.abs(value) / maxAbs, 1);
  const pct = Math.round(18 + strength * (maxMix - 18));
  const color = value > 0 ? "var(--up)" : "var(--down)";
  return `color-mix(in oklab, ${color} ${pct}%, var(--heat-neutral))`;
}
