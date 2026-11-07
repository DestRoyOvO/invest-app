import { describe, expect, it } from "vitest";

import { areaPath, extent, linePath, monthTicks, nearestIndex, niceTicks } from "./chart-geometry";

describe("extent", () => {
  it("spans every series and the included values", () => {
    expect(extent([[1, null, 5], [3, -2]])).toEqual([-2, 5]);
    expect(extent([[101, 99]], [100])).toEqual([99, 101]);
    expect(extent([[-0.2, -0.05]], [0])).toEqual([-0.2, 0]);
    expect(extent([[null, Number.NaN]])).toBeNull();
    expect(extent([])).toBeNull();
  });
});

describe("niceTicks", () => {
  it("picks round steps", () => {
    expect(niceTicks(92, 131, 4)).toEqual([100, 110, 120, 130]);
    expect(niceTicks(-0.18, 0, 4)).toEqual([-0.15, -0.1, -0.05, 0]);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
  });
});

describe("paths", () => {
  const x = (i: number) => i * 10;
  const y = (v: number) => 100 - v;

  it("draws a line that breaks at missing values", () => {
    expect(linePath([1, 2, null, 4, 5], x, y)).toBe("M0.0,99.0L10.0,98.0M30.0,96.0L40.0,95.0");
    expect(linePath([null, null], x, y)).toBe("");
  });

  it("closes each segment to the baseline", () => {
    expect(areaPath([-1, -2, null, -3], x, y, 100)).toBe("M0.0,101.0L10.0,102.0L10.0,100.0L0.0,100.0ZM30.0,103.0L30.0,100.0L30.0,100.0Z");
    expect(areaPath([], x, y, 100)).toBe("");
  });
});

describe("monthTicks", () => {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const dates = [day("2026-01-02"), day("2026-01-05"), day("2026-02-02"), day("2026-02-03"), day("2026-03-02"), day("2026-04-01")];

  it("marks the first session of each month", () => {
    expect(monthTicks(dates, 10).map((t) => t.index)).toEqual([0, 2, 4, 5]);
    expect(monthTicks(dates, 2).map((t) => t.index)).toEqual([0, 4]);
    expect(monthTicks(dates, 0)).toEqual([]);
  });

  it("skips a partial first month", () => {
    expect(monthTicks([day("2026-01-20"), day("2026-01-21"), day("2026-02-02")], 10).map((t) => t.index)).toEqual([2]);
  });
});

describe("nearestIndex", () => {
  it("maps a pixel to the nearest point and clamps", () => {
    expect(nearestIndex(50, 0, 100, 11)).toBe(5);
    expect(nearestIndex(54, 0, 100, 11)).toBe(5);
    expect(nearestIndex(56, 0, 100, 11)).toBe(6);
    expect(nearestIndex(-20, 0, 100, 11)).toBe(0);
    expect(nearestIndex(500, 0, 100, 11)).toBe(10);
    expect(nearestIndex(10, 0, 100, 1)).toBe(0);
  });
});
