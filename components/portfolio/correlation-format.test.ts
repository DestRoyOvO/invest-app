import { describe, expect, it } from "vitest";

import { correlationShade, formatCorrelation } from "./correlation-format";

describe("formatCorrelation", () => {
  it("prints two decimals with a true minus", () => {
    expect(formatCorrelation(0.8123)).toBe("0.81");
    expect(formatCorrelation(-0.456)).toBe("−0.46");
    expect(formatCorrelation(1)).toBe("1.00");
  });

  it("never prints a negative zero", () => {
    expect(formatCorrelation(-0.004)).toBe("0.00");
    expect(formatCorrelation(-0)).toBe("0.00");
    expect(formatCorrelation(0.004)).toBe("0.00");
    expect(formatCorrelation(-0.005)).toBe("−0.01");
  });
});

describe("correlationShade", () => {
  it("shades by magnitude only, so +r and -r look the same", () => {
    expect(correlationShade(0.5)).toBe("color-mix(in oklab, var(--info) 20%, var(--panel))");
    expect(correlationShade(-0.5)).toBe(correlationShade(0.5));
    expect(correlationShade(0)).toBe("color-mix(in oklab, var(--info) 0%, var(--panel))");
  });

  it("caps at 40% and skips missing values", () => {
    expect(correlationShade(1)).toBe("color-mix(in oklab, var(--info) 40%, var(--panel))");
    expect(correlationShade(1.2)).toBe("color-mix(in oklab, var(--info) 40%, var(--panel))");
    expect(correlationShade(null)).toBeUndefined();
    expect(correlationShade(Number.NaN)).toBeUndefined();
  });
});
