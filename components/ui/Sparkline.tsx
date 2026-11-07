import { memo } from "react";

import type { Direction } from "./delta-utils";
import { sparklineGeometry } from "./glyphs";

interface SparklineProps {
  data: readonly number[];
  width?: number;
  height?: number;
  /** Direction of the change of the day: colors only the end dot (up, down, or neutral for flat). */
  tone?: Direction;
  /** Dashed reference line at the first value, so the direction of the period reads by position, not color. */
  baseline?: boolean;
  className?: string;
  /** Accessible description; the sparkline is decorative without it. */
  label?: string;
}

const DOT: Record<Direction, string> = { up: "var(--up)", down: "var(--down)", flat: "var(--fg-3)" };

/**
 * Minimal SVG trend line in a neutral stroke (--spark). Only the 2.5px end dot is colored, by `tone`, which callers set
 * from the change of the day so the line never contradicts the number beside it.
 */
export const Sparkline = memo(function Sparkline({ data, width = 80, height = 24, tone = "flat", baseline = false, className, label }: SparklineProps) {
  const { path, end, baselineY } = sparklineGeometry(data, width, height);
  if (!path || !end) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  }
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {baseline && baselineY !== null ? (
        <line x1={0} x2={width} y1={baselineY} y2={baselineY} stroke="var(--line-2)" strokeWidth={1} strokeDasharray="2 2" />
      ) : null}
      <path d={path} fill="none" stroke="var(--spark)" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={end.x} cy={end.y} r={2.5} fill={DOT[tone]} />
    </svg>
  );
});
