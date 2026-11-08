// Pure geometry for the portfolio page's small SVG line charts: value ranges, round axis ticks, line and area paths
// that break at missing values, month ticks and the nearest point under the pointer. Kept free of React for tests.

type Series = ReadonlyArray<number | null>;

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Smallest and largest value across the series (and any values to include, e.g. a baseline); null when empty. */
export function extent(series: ReadonlyArray<Series>, include: readonly number[] = []): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const values of series) {
    for (const v of values) {
      if (!finite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return null;
  for (const v of include) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return [min, max];
}

/** About `count` round tick values (steps of 1, 2 or 5 times a power of ten) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!finite(min) || !finite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)) || 0);
  return ticks;
}

/** SVG path through the points, starting a new segment after each missing value. */
export function linePath(values: Series, x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (!finite(v)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Closed SVG path between the line and a baseline (for filled drawdown areas), one shape per unbroken segment. */
export function areaPath(values: Series, x: (i: number) => number, y: (v: number) => number, baseY: number): string {
  let d = "";
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    d += `L${x(end).toFixed(1)},${baseY.toFixed(1)}L${x(start).toFixed(1)},${baseY.toFixed(1)}Z`;
    start = -1;
  };
  values.forEach((v, i) => {
    if (!finite(v)) {
      close(i - 1);
      return;
    }
    d += `${start < 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    if (start < 0) start = i;
  });
  close(values.length - 1);
  return d;
}

/**
 * The first session of each calendar month (UTC dates, as the history uses), thinned evenly to at most `maxTicks`.
 * The first session of the series counts only when it opens a month.
 */
export function monthTicks(dates: readonly number[], maxTicks: number): Array<{ index: number; date: number }> {
  const ticks: Array<{ index: number; date: number }> = [];
  let month = -1;
  dates.forEach((date, index) => {
    const d = new Date(date);
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (key !== month) {
      if (month !== -1 || d.getUTCDate() <= 3) ticks.push({ index, date });
      month = key;
    }
  });
  if (maxTicks <= 0) return [];
  if (ticks.length <= maxTicks) return ticks;
  const every = Math.ceil(ticks.length / maxTicks);
  return ticks.filter((_, i) => i % every === 0);
}

/** Index of the point nearest a horizontal pixel position inside the plot area. */
export function nearestIndex(px: number, left: number, innerWidth: number, count: number): number {
  if (count <= 1 || innerWidth <= 0) return 0;
  const ratio = (px - left) / innerWidth;
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}
