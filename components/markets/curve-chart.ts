// Geometry of the yield curve chart (x = tenor, y = yield) and the spread sparklines, free of React for tests.

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CurveChartGeometry {
  /** x of each tenor, evenly spaced. */
  xs: number[];
  /** Gridlines at round yields, bottom to top. */
  yTicks: Array<{ value: number; y: number }>;
  /** One SVG path per series; a missing yield breaks the line into segments. Empty when a series has no points. */
  paths: string[];
  /** The plotted points of each series (null where the yield is missing). */
  points: Array<Array<{ x: number; y: number } | null>>;
}

const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2];

/** The smallest round step that splits `range` into at most `maxTicks` intervals. */
export function niceStep(range: number, maxTicks = 5): number {
  for (const step of STEPS) if (range / step <= maxTicks) return step;
  return STEPS[STEPS.length - 1];
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Lays the curves out in a width x height box: tenors evenly spaced along x (maturities from a month to 30 years would
 * crush the short end on a true time axis), yields on a y axis extended to round gridlines around every value.
 */
export function curveChartGeometry(series: ReadonlyArray<ReadonlyArray<number | null>>, width: number, height: number, pad: Padding): CurveChartGeometry {
  const count = Math.max(0, ...series.map((s) => s.length));
  const innerW = Math.max(width - pad.left - pad.right, 0);
  const innerH = Math.max(height - pad.top - pad.bottom, 0);
  const xs = Array.from({ length: count }, (_, i) => round(pad.left + (count > 1 ? (i / (count - 1)) * innerW : innerW / 2)));
  const values = series.flat().filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return { xs, yTicks: [], paths: series.map(() => ""), points: series.map((s) => s.map(() => null)) };

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const step = niceStep(Math.max(rawMax - rawMin, 0.1));
  let min = Math.floor((rawMin - step * 0.25) / step) * step;
  let max = Math.ceil((rawMax + step * 0.25) / step) * step;
  if (max - min < step) max = min + step;
  min = round(min);
  max = round(max);
  const y = (value: number) => round(pad.top + (1 - (value - min) / (max - min)) * innerH);

  const yTicks: Array<{ value: number; y: number }> = [];
  for (let value = min; value <= max + step / 1000; value = round(value + step)) yTicks.push({ value, y: y(value) });

  const points = series.map((s) => s.map((value, i) => (typeof value === "number" && Number.isFinite(value) ? { x: xs[i], y: y(value) } : null)));
  const paths = points.map((pts) => {
    let path = "";
    let pen = false;
    for (const point of pts) {
      if (!point) {
        pen = false;
        continue;
      }
      path += `${path ? " " : ""}${pen ? "L" : "M"}${point.x},${point.y}`;
      pen = true;
    }
    return path;
  });
  return { xs, yTicks, paths, points };
}

/** Rough width of an axis label in px: CJK characters are about 1em wide, digits and Latin letters about 0.6em. */
export function labelWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) width += /[⺀-鿿豈-﫿＀-￯]/.test(char) ? fontSize : fontSize * 0.6;
  return width;
}

/**
 * Which axis labels fit, as indexes into `labels` (centred at `x`, left to right): each label needs `gap` px of space
 * after the one before it, otherwise it is skipped. The last label (the long end of the curve) always shows, in place
 * of the labels before it that it would run into.
 */
export function fitAxisLabels(labels: ReadonlyArray<{ x: number; width: number }>, gap = 4): number[] {
  const kept: number[] = [];
  const clear = (a: number, b: number) => labels[b].x - labels[b].width / 2 >= labels[a].x + labels[a].width / 2 + gap;
  labels.forEach((_, index) => {
    const last = index === labels.length - 1;
    if (kept.length === 0 || clear(kept[kept.length - 1], index)) kept.push(index);
    else if (last) {
      while (kept.length > 0 && !clear(kept[kept.length - 1], index)) kept.pop();
      kept.push(index);
    }
  });
  return kept;
}

/** True when a spread history reaches back about a year before the latest curve (it starts 350 or more days earlier). */
export function coversYear(history: ReadonlyArray<{ date: string }>, latestDate: string): boolean {
  const first = history[0]?.date;
  if (!first) return false;
  return Date.parse(latestDate) - Date.parse(first) >= 350 * 86_400_000;
}

export interface SpreadSparkGeometry {
  path: string;
  /** y of the zero line (the inversion threshold), which the range always includes. */
  zeroY: number | null;
  end: { x: number; y: number } | null;
}

/** A spread history (basis points) in a width x height box, scaled to include zero so the distance from inversion shows. */
export function spreadSparkGeometry(values: readonly number[], width: number, height: number, inset = 3): SpreadSparkGeometry {
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length < 2) return { path: "", zeroY: null, end: null };
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const span = max - min || 1;
  const innerW = width - inset * 2;
  const innerH = height - inset * 2;
  const x = (i: number) => round(inset + (i / (points.length - 1)) * innerW);
  const y = (value: number) => round(inset + (1 - (value - min) / span) * innerH);
  const path = points.map((value, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(value)}`).join(" ");
  return { path, zeroY: y(0), end: { x: x(points.length - 1), y: y(points[points.length - 1]) } };
}
