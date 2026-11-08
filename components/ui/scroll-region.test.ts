import { describe, expect, it } from "vitest";

import { isScrollable, overflowsScrollBox } from "./scroll-region";

const box = (scrollWidth: number, clientWidth: number, scrollHeight = 100, clientHeight = 100) => ({ scrollWidth, clientWidth, scrollHeight, clientHeight });

describe("isScrollable", () => {
  it("accepts only the overflow values that scroll", () => {
    expect(isScrollable("auto")).toBe(true);
    expect(isScrollable("scroll")).toBe(true);
    for (const value of ["visible", "hidden", "clip", ""]) expect(isScrollable(value)).toBe(false);
  });
});

describe("overflowsScrollBox", () => {
  it("is true when a minWidth table is wider than its scroll box", () => {
    expect(overflowsScrollBox(box(544, 388), "auto", "auto")).toBe(true);
  });

  it("is false when everything fits, allowing a pixel of rounding", () => {
    expect(overflowsScrollBox(box(388, 388), "auto", "auto")).toBe(false);
    expect(overflowsScrollBox(box(389, 388), "auto", "auto")).toBe(false);
    expect(overflowsScrollBox(box(390, 388), "auto", "auto")).toBe(true);
  });

  it("counts a maxHeight box whose rows are taller than it", () => {
    expect(overflowsScrollBox(box(388, 388, 3237, 540), "auto", "auto")).toBe(true);
  });

  it("ignores an axis that does not scroll, such as a wrapper turned off with overflow-x-visible!", () => {
    expect(overflowsScrollBox(box(736, 388), "visible", "visible")).toBe(false);
    expect(overflowsScrollBox(box(736, 388, 900, 100), "hidden", "auto")).toBe(true);
    expect(overflowsScrollBox(box(736, 388, 900, 100), "auto", "hidden")).toBe(true);
    expect(overflowsScrollBox(box(736, 388, 900, 100), "hidden", "hidden")).toBe(false);
  });
});
