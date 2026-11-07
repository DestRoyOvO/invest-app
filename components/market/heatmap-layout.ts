// Geometry for the sector heatmap, kept free of React so it can be tested: the nested treemap with sector gutters and
// tile gaps snapped to whole pixels, which labels fit in a tile or a sector header, and arrow-key movement between the
// rectangles.

import { squarify, type Rect } from "@/lib/treemap";

/** Gap between sectors and between tiles, in px. */
export const SECTOR_GUTTER = 2;
export const TILE_GAP = 1;
/** Height of a sector header strip, including the tile gap under it. */
export const SECTOR_HEADER = 19;
/** A sector needs this much room before it gets a header strip. */
const HEADER_MIN_WIDTH = 36;
const HEADER_MIN_HEIGHT = 56;

export const MIN_SYMBOL_PX = 11;
export const MAX_SYMBOL_PX = 22;

export interface LayoutSector<T> {
  key: string;
  items: ReadonlyArray<{ item: T; weight: number }>;
}

export interface PlacedTile<T> extends Rect {
  item: T;
}

export interface PlacedSector<T> extends Rect {
  key: string;
  /** Height of the header strip (0 when the sector is too small for one or headers are off). */
  header: number;
  tiles: PlacedTile<T>[];
}

/**
 * Squarified treemap of sectors, then of the stocks inside each sector, filling width x height. Sectors are separated
 * by SECTOR_GUTTER px and tiles by TILE_GAP px; every edge is snapped to a whole pixel so the gaps render evenly, and
 * the outer tiles sit flush with the container. Items without a positive weight are left out.
 */
export function layoutHeatmap<T>(
  sectors: ReadonlyArray<LayoutSector<T>>,
  width: number,
  height: number,
  { headers = true }: { headers?: boolean } = {},
): PlacedSector<T>[] {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w < 10 || h < 10) return [];
  const half = SECTOR_GUTTER / 2;
  const weighted = sectors
    .map((sector) => ({ sector, items: sector.items.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0) }))
    .filter((entry) => entry.items.length > 0);
  // Lay sectors out in a box one half-gutter larger on every side, then inset each by a half-gutter: neighbours end up a
  // full gutter apart while the outer edges stay on the container's edges.
  const boxes = squarify(
    weighted.map((entry) => ({ item: entry, value: entry.items.reduce((sum, item) => sum + item.weight, 0) })),
    { x: -half, y: -half, w: w + SECTOR_GUTTER, h: h + SECTOR_GUTTER },
  );
  return boxes.map((box) => {
    const x = Math.round(box.x) + half;
    const y = Math.round(box.y) + half;
    const sw = Math.round(box.x + box.w) - half - x;
    const sh = Math.round(box.y + box.h) - half - y;
    const header = headers && sw >= HEADER_MIN_WIDTH && sh >= HEADER_MIN_HEIGHT ? SECTOR_HEADER : 0;
    const area = { x, y: y + header, w: sw, h: sh - header };
    // Same trick for the tiles: a box one gap larger, then each tile loses the gap on its right and bottom edges.
    const tiles = squarify(
      box.item.items.map((entry) => ({ item: entry.item, value: entry.weight })),
      { x: area.x, y: area.y, w: area.w + TILE_GAP, h: area.h + TILE_GAP },
    ).map((tile) => {
      const tx = Math.round(tile.x);
      const ty = Math.round(tile.y);
      return {
        item: tile.item,
        x: tx,
        y: ty,
        w: Math.max(0, Math.round(tile.x + tile.w) - tx - TILE_GAP),
        h: Math.max(0, Math.round(tile.y + tile.h) - ty - TILE_GAP),
      };
    });
    return { key: box.item.sector.key, x, y, w: sw, h: sh, header, tiles };
  });
}

const CJK = /[⺀-鿿豈-﫿＀-￯]/;

/**
 * Approximate rendered width of a label in px: IBM Plex Mono advances 0.6em per glyph; Plex Sans figures are 0.6em
 * (tabular) and letters average about 0.55em; CJK glyphs are 1em. Errs a little wide so labels never touch the edges.
 */
export function textWidth(text: string, fontSize: number, face: "mono" | "sans"): number {
  let ems = 0;
  for (const char of text) {
    if (CJK.test(char)) ems += 1;
    else if (face === "mono") ems += 0.6;
    else if (char === " ") ems += 0.3;
    else if (/[0-9+−.,%-]/.test(char)) ems += 0.6;
    else if (/[A-Z&]/.test(char)) ems += 0.66;
    else ems += 0.55;
  }
  return ems * fontSize * 1.05;
}

export interface TileLabel {
  /** Font size of the symbol in px; the change is set at 0.8x (at least 10px). */
  fontSize: number;
  changeSize: number;
  showSymbol: boolean;
  showChange: boolean;
}

const TILE_PAD_X = 6;
const TILE_PAD_Y = 4;
const LINE = 1.15;

/**
 * What fits in a tile of w x h px: the symbol at clamp(11px, sqrt(w*h)/9, 22px), shrunk towards 11px when the tile is
 * narrow, and the change under it at 0.8x when there is room for both lines.
 */
export function tileLabel(w: number, h: number, symbol: string, change: string): TileLabel {
  let fontSize = Math.min(MAX_SYMBOL_PX, Math.max(MIN_SYMBOL_PX, Math.sqrt(Math.max(w * h, 0)) / 9));
  const symbolEms = textWidth(symbol, 1, "mono");
  if (symbolEms > 0) fontSize = Math.min(fontSize, (w - TILE_PAD_X) / symbolEms);
  const showSymbol = fontSize >= MIN_SYMBOL_PX && h >= fontSize * LINE + TILE_PAD_Y;
  const shown = showSymbol ? Math.round(fontSize * 10) / 10 : MIN_SYMBOL_PX;
  const changeSize = Math.max(10, Math.round(shown * 0.8 * 10) / 10);
  const showChange =
    showSymbol && w >= textWidth(change, changeSize, "sans") + TILE_PAD_X && h >= shown * LINE + changeSize * LINE + TILE_PAD_Y;
  return { fontSize: shown, changeSize, showSymbol, showChange };
}

export interface HeaderLabel {
  /** Show the sector's short label (it truncates with an ellipsis when even that is too wide). */
  showLabel: boolean;
  showChange: boolean;
}

const HEADER_FONT = 11;
const HEADER_PAD = 12;
const HEADER_GAP = 6;

/** Whether a header strip of width w has room for the short label and the change, the label alone, or nothing. */
export function headerLabel(w: number, label: string, change: string): HeaderLabel {
  const labelWidth = textWidth(label, HEADER_FONT, "sans");
  const changeWidth = textWidth(change, HEADER_FONT, "sans");
  if (w >= labelWidth + HEADER_GAP + changeWidth + HEADER_PAD) return { showLabel: true, showChange: true };
  return { showLabel: w >= 24, showChange: false };
}

export type Direction = "left" | "right" | "up" | "down";

/** Distance between two ranges on one axis; 0 when they overlap. */
function rangeGap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, b0 - a1, a0 - b1);
}

/**
 * The rectangle an arrow key moves to: among the rectangles entirely past the current one's edge in that direction,
 * the nearest, counting sideways misalignment double and breaking ties by how well the centres line up. Returns
 * `from` when nothing lies that way.
 */
export function nextInDirection(rects: readonly Rect[], from: number, direction: Direction): number {
  const a = rects[from];
  if (!a) return from;
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  let best = from;
  let bestScore = Infinity;
  rects.forEach((b, index) => {
    if (index === from) return;
    let primary: number;
    let sideways: number;
    let centres: number;
    const slack = 0.5;
    if (direction === "right" || direction === "left") {
      if (direction === "right" ? b.x < a.x + a.w - slack : b.x + b.w > a.x + slack) return;
      primary = direction === "right" ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
      sideways = rangeGap(a.y, a.y + a.h, b.y, b.y + b.h);
      centres = Math.abs(b.y + b.h / 2 - ay);
    } else {
      if (direction === "down" ? b.y < a.y + a.h - slack : b.y + b.h > a.y + slack) return;
      primary = direction === "down" ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
      sideways = rangeGap(a.x, a.x + a.w, b.x, b.x + b.w);
      centres = Math.abs(b.x + b.w / 2 - ax);
    }
    const score = Math.max(primary, 0) + sideways * 2 + centres * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}
