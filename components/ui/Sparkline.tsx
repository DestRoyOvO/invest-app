import { memo } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** Override the color direction; defaults to last vs first value. */
  up?: boolean;
  className?: string;
  label?: string;
}

/** Minimal SVG line chart. Decorative unless `label` is given. */
export const Sparkline = memo(function Sparkline({ data, width = 80, height = 24, up, className, label }: SparklineProps) {
  const points = data.filter((v) => Number.isFinite(v));
  if (points.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const pad = 1.5;
  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(pad + (1 - (v - min) / range) * (height - pad * 2)).toFixed(1)}`)
    .join(" ");
  const rising = up ?? points[points.length - 1] >= points[0];
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
      <path d={path} fill="none" stroke={rising ? "var(--up)" : "var(--down)"} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
});
