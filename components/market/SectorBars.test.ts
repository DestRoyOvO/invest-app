import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DivergingBar } from "./SectorBars";

/** The markup of a sector's bar on a scale whose largest move is 2%. */
const bar = (change: number | null) => renderToStaticMarkup(createElement(DivergingBar, { change, maxAbs: 2 }));

describe("DivergingBar", () => {
  it("draws the change as the percent beside it shows it, so a change that reads 0.00% has no bar", () => {
    for (const change of [-0.0027, 0.004, 0, null]) expect(bar(change), String(change)).not.toMatch(/bg-(up|down)/);
    expect(bar(-0.05)).toMatch(/class="absolute inset-y-0 right-1\/2 bg-down\/70" style="width:1.25%"/);
    expect(bar(1)).toMatch(/class="absolute inset-y-0 left-1\/2 bg-up\/70" style="width:25%"/);
    // Moves beyond the scale stop at its edge.
    expect(bar(-3)).toMatch(/bg-down\/70" style="width:50%"/);
  });
});
