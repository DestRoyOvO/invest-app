import { describe, expect, it } from "vitest";

import type { Rect } from "@/lib/treemap";

import {
  headerLabel,
  layoutHeatmap,
  MAX_SYMBOL_PX,
  MIN_SYMBOL_PX,
  nextInDirection,
  SECTOR_GUTTER,
  SECTOR_HEADER,
  textWidth,
  tileLabel,
  TILE_GAP,
  type LayoutSector,
} from "./heatmap-layout";

function sector(key: string, weights: number[]): LayoutSector<string> {
  return { key, items: weights.map((weight, i) => ({ item: `${key}${i}`, weight })) };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("layoutHeatmap", () => {
  const sectors = [sector("tech", [50, 30, 20, 5]), sector("fin", [30, 10]), sector("energy", [8, 4, 2]), sector("util", [3])];
  const layout = layoutHeatmap(sectors, 800, 420);

  it("fills the box edge to edge with whole-pixel rectangles", () => {
    const xs = layout.map((s) => [s.x, s.x + s.w]).flat();
    const ys = layout.map((s) => [s.y, s.y + s.h]).flat();
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(800);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(420);
    for (const s of layout) {
      for (const value of [s.x, s.y, s.w, s.h, ...s.tiles.flatMap((t) => [t.x, t.y, t.w, t.h])]) expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("keeps sectors a gutter apart and tiles a gap apart, never overlapping", () => {
    for (let i = 0; i < layout.length; i += 1) {
      for (let j = i + 1; j < layout.length; j += 1) {
        const [a, b] = [layout[i], layout[j]];
        expect(overlaps(a, b)).toBe(false);
        // Sectors that touch along an edge are exactly one gutter apart.
        const horizontal = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
        const vertical = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
        expect(Math.max(horizontal, vertical)).toBeGreaterThanOrEqual(SECTOR_GUTTER);
      }
    }
    const tech = layout.find((s) => s.key === "tech");
    const tiles = tech?.tiles ?? [];
    expect(tiles).toHaveLength(4);
    for (let i = 0; i < tiles.length; i += 1) {
      for (let j = i + 1; j < tiles.length; j += 1) {
        expect(overlaps(tiles[i], tiles[j])).toBe(false);
        const [a, b] = [tiles[i], tiles[j]];
        const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
        expect(gap).toBeGreaterThanOrEqual(TILE_GAP);
      }
    }
  });

  it("gives large sectors a header strip and keeps tiles inside their sector below it", () => {
    for (const s of layout) {
      for (const tile of s.tiles) {
        expect(tile.x).toBeGreaterThanOrEqual(s.x);
        expect(tile.y).toBeGreaterThanOrEqual(s.y + s.header);
        expect(tile.x + tile.w).toBeLessThanOrEqual(s.x + s.w);
        expect(tile.y + tile.h).toBeLessThanOrEqual(s.y + s.h);
      }
    }
    expect(layout.find((s) => s.key === "tech")?.header).toBe(SECTOR_HEADER);
    expect(layoutHeatmap(sectors, 800, 420, { headers: false }).every((s) => s.header === 0)).toBe(true);
  });

  it("sizes areas by weight and drops items without a positive weight", () => {
    const [big, small] = layoutHeatmap([sector("a", [3]), sector("b", [1, 0, Number.NaN])], 400, 100, { headers: false });
    expect(big.w * big.h).toBeGreaterThan(2.5 * small.w * small.h);
    expect(small.tiles).toHaveLength(1);
    expect(layoutHeatmap([sector("none", [0])], 400, 100)).toEqual([]);
    expect(layoutHeatmap(sectors, 5, 100)).toEqual([]);
  });
});

describe("tileLabel", () => {
  it("scales the symbol with the tile between 11 and 22 px", () => {
    expect(tileLabel(300, 200, "NVDA", "+2.78%").fontSize).toBe(MAX_SYMBOL_PX);
    expect(tileLabel(110, 90, "NVDA", "+2.78%").fontSize).toBeCloseTo(Math.sqrt(110 * 90) / 9, 1);
    expect(tileLabel(60, 40, "KO", "+0.10%").fontSize).toBe(MIN_SYMBOL_PX);
  });

  it("shows both lines, the symbol alone, or nothing as room shrinks", () => {
    expect(tileLabel(120, 80, "MSFT", "−0.99%")).toMatchObject({ showSymbol: true, showChange: true });
    expect(tileLabel(48, 20, "MSFT", "−0.99%")).toMatchObject({ showSymbol: true, showChange: false });
    expect(tileLabel(20, 20, "MSFT", "−0.99%")).toMatchObject({ showSymbol: false, showChange: false });
    expect(tileLabel(200, 12, "MSFT", "−0.99%").showSymbol).toBe(false);
  });

  it("shrinks a long symbol to fit a narrow tile before hiding it", () => {
    const label = tileLabel(70, 120, "GOOGL", "+1.00%");
    expect(label.showSymbol).toBe(true);
    expect(textWidth("GOOGL", label.fontSize, "mono")).toBeLessThanOrEqual(70);
    expect(label.changeSize).toBeGreaterThanOrEqual(10);
  });
});

describe("headerLabel", () => {
  it("drops the change before the label", () => {
    expect(headerLabel(200, "Tech", "+0.80%")).toEqual({ showLabel: true, showChange: true });
    expect(headerLabel(50, "Tech", "+0.80%")).toEqual({ showLabel: true, showChange: false });
    expect(headerLabel(20, "Tech", "+0.80%")).toEqual({ showLabel: false, showChange: false });
  });

  it("measures Chinese labels as full-width glyphs", () => {
    expect(textWidth("可选消费", 11, "sans")).toBeGreaterThan(textWidth("Cons", 11, "sans") * 1.5);
  });
});

describe("nextInDirection", () => {
  //  +---+---+
  //  | 0 | 1 |
  //  +---+---+
  //  |   2   |
  //  +-------+
  const rects: Rect[] = [
    { x: 0, y: 0, w: 50, h: 50 },
    { x: 51, y: 0, w: 50, h: 50 },
    { x: 0, y: 51, w: 101, h: 30 },
  ];

  it("moves to the nearest rectangle past the edge", () => {
    expect(nextInDirection(rects, 0, "right")).toBe(1);
    expect(nextInDirection(rects, 1, "left")).toBe(0);
    expect(nextInDirection(rects, 0, "down")).toBe(2);
    expect(nextInDirection(rects, 1, "down")).toBe(2);
    expect(nextInDirection(rects, 2, "up")).toBe(0);
  });

  it("stays put when nothing lies that way", () => {
    expect(nextInDirection(rects, 1, "right")).toBe(1);
    expect(nextInDirection(rects, 0, "up")).toBe(0);
    expect(nextInDirection([], 0, "up")).toBe(0);
  });

  it("prefers a rectangle in line over a nearer one off to the side", () => {
    const row: Rect[] = [
      { x: 0, y: 40, w: 20, h: 20 },
      { x: 30, y: 0, w: 10, h: 10 },
      { x: 60, y: 40, w: 20, h: 20 },
    ];
    expect(nextInDirection(row, 0, "right")).toBe(2);
  });
});
