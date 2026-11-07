import { describe, expect, it } from "vitest";

import { squarify } from "./treemap";

const rect = { x: 0, y: 0, w: 600, h: 400 };

describe("squarify", () => {
  it("returns nothing for empty or non-positive input", () => {
    expect(squarify([], rect)).toEqual([]);
    expect(squarify([{ item: "a", value: 0 }, { item: "b", value: -3 }], rect)).toEqual([]);
  });

  it("fills the rectangle with areas proportional to values", () => {
    const values = [500, 300, 120, 80, 60, 40, 25, 10, 5];
    const nodes = squarify(values.map((value, i) => ({ item: i, value })), rect);
    expect(nodes).toHaveLength(values.length);
    const total = values.reduce((s, v) => s + v, 0);
    const totalArea = nodes.reduce((s, n) => s + n.w * n.h, 0);
    expect(totalArea).toBeCloseTo(rect.w * rect.h, 3);
    for (const node of nodes) {
      expect(node.w * node.h).toBeCloseTo((node.value / total) * rect.w * rect.h, 3);
      expect(node.x).toBeGreaterThanOrEqual(-1e-9);
      expect(node.y).toBeGreaterThanOrEqual(-1e-9);
      expect(node.x + node.w).toBeLessThanOrEqual(rect.w + 1e-6);
      expect(node.y + node.h).toBeLessThanOrEqual(rect.h + 1e-6);
    }
  });

  it("does not overlap rectangles", () => {
    const nodes = squarify(
      [9, 7, 6, 4, 3, 2, 2, 1].map((value, i) => ({ item: i, value })),
      rect,
    );
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapX <= 1e-6 || overlapY <= 1e-6).toBe(true);
      }
    }
  });

  it("keeps aspect ratios reasonable for similar values", () => {
    const nodes = squarify(Array.from({ length: 16 }, (_, i) => ({ item: i, value: 1 })), { x: 0, y: 0, w: 400, h: 400 });
    for (const node of nodes) {
      const ratio = Math.max(node.w / node.h, node.h / node.w);
      expect(ratio).toBeLessThan(3);
    }
  });
});
