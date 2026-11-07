import { describe, expect, it } from "vitest";

import { retryWait } from "./wait";

describe("retryWait", () => {
  it("counts short waits in seconds", () => {
    expect(retryWait(1)).toEqual({ unit: "s", value: 1 });
    expect(retryWait(42.2)).toEqual({ unit: "s", value: 43 });
    expect(retryWait(119)).toEqual({ unit: "s", value: 119 });
  });

  it("counts waits of two minutes or more in minutes, rounded up", () => {
    expect(retryWait(120)).toEqual({ unit: "min", value: 2 });
    expect(retryWait(121)).toEqual({ unit: "min", value: 3 });
    // The sign-in limit's longest wait: 15 minutes.
    expect(retryWait(851)).toEqual({ unit: "min", value: 15 });
    expect(retryWait(900)).toEqual({ unit: "min", value: 15 });
  });

  it("falls back to a minute without a usable Retry-After", () => {
    for (const value of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(retryWait(value)).toEqual({ unit: "s", value: 60 });
  });
});
