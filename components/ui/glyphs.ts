// Geometry for the small inline glyphs (Sparkline, Whisker, Meter), kept free of React so it can be tested.

const round = (value: number) => Math.round(value * 100) / 100;

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Clamps a value into [min, max] and returns its position as 0-100. Not-a-number gives null. */
export function toPercent(value: number | null | undefined, min = 0, max = 100): number | null {
  if (!isNum(value) || !(max > min)) return null;
  return Math.min(Math.max(((value - min) / (max - min)) * 100, 0), 100);
}

export interface SparklineGeometry {
  /** SVG path through the finite points; empty when there are fewer than two. */
  path: string;
  /** The last point, where the end dot sits. */
  end: { x: number; y: number } | null;
  /** y of the first value, for the dashed reference line. */
  baselineY: number | null;
}

/**
 * Maps a series onto a width x height box, keeping `inset` pixels clear on every side so the end dot is never clipped.
 * Non-finite values are skipped; a constant series draws a flat line through the middle.
 */
export function sparklineGeometry(data: readonly number[], width: number, height: number, inset = 3): SparklineGeometry {
  const points = data.filter((value) => Number.isFinite(value));
  if (points.length < 2 || width <= inset * 2 || height <= inset * 2) return { path: "", end: null, baselineY: null };
  const min = Math.min(...points);
  const max = Math.max(...points);
  const innerWidth = width - inset * 2;
  const innerHeight = height - inset * 2;
  const x = (i: number) => round(inset + (i / (points.length - 1)) * innerWidth);
  const y = (value: number) => round(max === min ? inset + innerHeight / 2 : inset + (1 - (value - min) / (max - min)) * innerHeight);
  const path = points.map((value, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(value)}`).join(" ");
  return { path, end: { x: x(points.length - 1), y: y(points[points.length - 1]) }, baselineY: y(points[0]) };
}

export interface WhiskerInput {
  estimate: number | null | undefined;
  low?: number | null;
  high?: number | null;
  base?: number | null;
  /** Domain of the track; values outside are pinned to the ends. */
  min?: number;
  max?: number;
  width: number;
  height: number;
  dotRadius?: number;
}

export interface WhiskerGeometry {
  track: { x1: number; x2: number };
  midY: number;
  interval: { x1: number; x2: number } | null;
  baseX: number | null;
  dot: { x: number; r: number } | null;
  /** True when the whole interval lies above or below the base rate: only then does the estimate stand out. */
  excludesBase: boolean;
}

/** Positions of a whisker glyph: a 0-to-max track, the base-rate tick, the interval line and the estimate dot. */
export function whiskerGeometry({ estimate, low, high, base, min = 0, max = 1, width, height, dotRadius = 3 }: WhiskerInput): WhiskerGeometry {
  const pad = dotRadius;
  const span = Math.max(width - pad * 2, 0);
  const x = (value: number) => {
    const t = max > min ? (value - min) / (max - min) : 0.5;
    return round(pad + Math.min(Math.max(t, 0), 1) * span);
  };
  const hasInterval = isNum(low) && isNum(high);
  const interval = hasInterval ? { x1: x(Math.min(low, high)), x2: x(Math.max(low, high)) } : null;
  const excludesBase = hasInterval && isNum(base) ? base < Math.min(low, high) || base > Math.max(low, high) : false;
  return {
    track: { x1: pad, x2: round(pad + span) },
    midY: round(height / 2),
    interval,
    baseX: isNum(base) ? x(base) : null,
    dot: isNum(estimate) ? { x: x(estimate), r: dotRadius } : null,
    excludesBase,
  };
}
