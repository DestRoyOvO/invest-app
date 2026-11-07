import { cn } from "@/lib/cn";

import { whiskerGeometry } from "./glyphs";

interface WhiskerProps {
  /** Point estimate, e.g. a hit rate (0.543). */
  estimate: number | null | undefined;
  /** Confidence interval bounds on the same scale. */
  low?: number | null;
  high?: number | null;
  /** Base rate to compare against, e.g. the hit rate of all sessions. */
  base?: number | null;
  /** Domain of the track (default 0 to 1). Narrow it so a small interval stays visible, e.g. 0.3 to 0.7. */
  min?: number;
  max?: number;
  width?: number;
  height?: number;
  /**
   * The exact numbers in words, e.g. "Hit rate 54.3%, 95% interval 51.8 to 56.8%, base rate 54.3%". Required:
   * the glyph alone cannot be read by screen readers.
   */
  label: string;
  className?: string;
}

/**
 * Compact interval glyph for honest track records: a track, a 1px tick at the base rate, a 1px line across the
 * interval and a dot at the estimate. The dot turns accent only when the interval excludes the base rate, which is what
 * a real edge looks like; an interval that overlaps the base stays neutral.
 */
export function Whisker({ estimate, low, high, base, min = 0, max = 1, width = 72, height = 12, label, className }: WhiskerProps) {
  const g = whiskerGeometry({ estimate, low, high, base, min, max, width, height });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={cn("inline-block shrink-0 align-middle", className)}>
      <title>{label}</title>
      <rect x={g.track.x1} y={g.midY - 1} width={Math.max(g.track.x2 - g.track.x1, 0)} height={2} fill="var(--line-2)" />
      {g.baseX !== null ? <rect x={g.baseX - 0.5} y={1} width={1} height={height - 2} fill="var(--fg-3)" /> : null}
      {g.interval ? <rect x={g.interval.x1} y={g.midY - 0.5} width={Math.max(g.interval.x2 - g.interval.x1, 1)} height={1} fill="var(--fg-2)" /> : null}
      {g.dot ? <circle cx={g.dot.x} cy={g.midY} r={g.dot.r} fill={g.excludesBase ? "var(--accent)" : "var(--fg)"} /> : null}
    </svg>
  );
}
