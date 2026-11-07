import { describe, expect, it } from "vitest";

import { tickDirection } from "./useTickFlash";

describe("tickDirection", () => {
  it("reports the direction of a change", () => {
    expect(tickDirection(100, 100.5)).toBe("up");
    expect(tickDirection(100, 99.99)).toBe("down");
  });

  it("does not flash unchanged or missing values", () => {
    expect(tickDirection(100, 100)).toBeNull();
    expect(tickDirection(null, 100)).toBeNull();
    expect(tickDirection(100, null)).toBeNull();
    expect(tickDirection(undefined, 1)).toBeNull();
    expect(tickDirection(Number.NaN, 1)).toBeNull();
  });
});
