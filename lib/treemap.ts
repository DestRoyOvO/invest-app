// Squarified treemap layout (Bruls, Huizing & van Wijk, 2000).
// Produces rectangles whose areas are proportional to the input values, with aspect ratios close to 1.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapNode<T> extends Rect {
  item: T;
  value: number;
}

interface Sized<T> {
  item: T;
  value: number;
  area: number;
}

function worstRatio<T>(row: Sized<T>[], side: number): number {
  let sum = 0;
  let max = 0;
  let min = Infinity;
  for (const r of row) {
    sum += r.area;
    if (r.area > max) max = r.area;
    if (r.area < min) min = r.area;
  }
  const sideSq = side * side;
  const sumSq = sum * sum;
  return Math.max((sideSq * max) / sumSq, sumSq / (sideSq * min));
}

function layoutRow<T>(row: Sized<T>[], rect: Rect, out: TreemapNode<T>[]): Rect {
  const sum = row.reduce((s, r) => s + r.area, 0);
  if (rect.w >= rect.h) {
    // Fill a column along the left edge.
    const width = sum / rect.h;
    let y = rect.y;
    for (const r of row) {
      const height = r.area / width;
      out.push({ x: rect.x, y, w: width, h: height, item: r.item, value: r.value });
      y += height;
    }
    return { x: rect.x + width, y: rect.y, w: rect.w - width, h: rect.h };
  }
  // Fill a row along the top edge.
  const height = sum / rect.w;
  let x = rect.x;
  for (const r of row) {
    const width = r.area / height;
    out.push({ x, y: rect.y, w: width, h: height, item: r.item, value: r.value });
    x += width;
  }
  return { x: rect.x, y: rect.y + height, w: rect.w, h: rect.h - height };
}

/** Lays out items (value > 0) inside `rect`. Items are placed largest first. */
export function squarify<T>(items: Array<{ item: T; value: number }>, rect: Rect): TreemapNode<T>[] {
  const valid = items.filter((i) => Number.isFinite(i.value) && i.value > 0).sort((a, b) => b.value - a.value);
  const total = valid.reduce((s, i) => s + i.value, 0);
  if (valid.length === 0 || total <= 0 || rect.w <= 0 || rect.h <= 0) return [];

  const scale = (rect.w * rect.h) / total;
  const sized: Sized<T>[] = valid.map((i) => ({ item: i.item, value: i.value, area: i.value * scale }));
  const out: TreemapNode<T>[] = [];
  let remaining: Rect = { ...rect };
  let row: Sized<T>[] = [];

  for (let i = 0; i < sized.length; ) {
    const side = Math.min(remaining.w, remaining.h);
    const candidate = [...row, sized[i]];
    if (row.length === 0 || worstRatio(candidate, side) <= worstRatio(row, side)) {
      row = candidate;
      i++;
    } else {
      remaining = layoutRow(row, remaining, out);
      row = [];
    }
  }
  if (row.length > 0) layoutRow(row, remaining, out);
  return out;
}
