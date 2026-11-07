import { describe, expect, it } from "vitest";

import { placeFloating } from "./floating";

const viewport = { width: 1000, height: 800 };
const card = { width: 200, height: 100 };

describe("placeFloating", () => {
  it("places below and centered when there is room", () => {
    const pos = placeFloating({ x: 400, y: 100, width: 100, height: 20 }, card, viewport, "bottom");
    expect(pos).toEqual({ x: 350, y: 126, side: "bottom" });
  });

  it("flips to the top when the bottom has no room", () => {
    const pos = placeFloating({ x: 400, y: 740, width: 100, height: 20 }, card, viewport, "bottom");
    expect(pos.side).toBe("top");
    expect(pos.y).toBe(740 - 6 - 100);
  });

  it("keeps the preferred side when the opposite has even less room", () => {
    const tall = { width: 200, height: 700 };
    const pos = placeFloating({ x: 400, y: 500, width: 100, height: 20 }, tall, viewport, "top");
    expect(pos.side).toBe("top");
    // Clamped into the viewport with the margin.
    expect(pos.y).toBe(8);
  });

  it("clamps to the right and left edges", () => {
    expect(placeFloating({ x: 960, y: 100, width: 30, height: 20 }, card, viewport).x).toBe(1000 - 200 - 8);
    expect(placeFloating({ x: 0, y: 100, width: 30, height: 20 }, card, viewport).x).toBe(8);
  });

  it("supports the left and right sides and flips between them", () => {
    const right = placeFloating({ x: 100, y: 300, width: 40, height: 40 }, card, viewport, "right");
    expect(right).toEqual({ x: 146, y: 270, side: "right" });
    const flipped = placeFloating({ x: 900, y: 300, width: 40, height: 40 }, card, viewport, "right");
    expect(flipped.side).toBe("left");
    expect(flipped.x).toBe(900 - 6 - 200);
  });

  it("pins a box wider than the viewport to the margin", () => {
    const pos = placeFloating({ x: 10, y: 10, width: 10, height: 10 }, { width: 2000, height: 50 }, viewport);
    expect(pos.x).toBe(8);
  });

  it("honours custom offset and margin", () => {
    const pos = placeFloating({ x: 400, y: 100, width: 100, height: 20 }, card, viewport, "bottom", { offset: 0, margin: 0 });
    expect(pos.y).toBe(120);
  });
});
