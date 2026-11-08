import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Delta } from "./Delta";
import { directionOf, HEAT_EDGES, HEAT_STEPS, heatStep, heatStyle, shownValue, withTrueMinus } from "./delta-utils";

describe("heatStep", () => {
  it("is flat below 0.10% and for missing values", () => {
    expect(heatStep(0)).toBe(0);
    expect(heatStep(0.0999)).toBe(0);
    expect(heatStep(-0.0999)).toBe(0);
    expect(heatStep(null)).toBe(0);
    expect(heatStep(undefined)).toBe(0);
    expect(heatStep(Number.NaN)).toBe(0);
    expect(heatStep(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("steps up at each edge, inclusive", () => {
    expect(heatStep(0.1)).toBe(1);
    expect(heatStep(0.74)).toBe(1);
    expect(heatStep(0.75)).toBe(2);
    expect(heatStep(1.74)).toBe(2);
    expect(heatStep(1.75)).toBe(3);
    expect(heatStep(3.49)).toBe(3);
    expect(heatStep(3.5)).toBe(4);
    expect(heatStep(11.04)).toBe(4);
  });

  it("mirrors negative moves", () => {
    expect(heatStep(-0.1)).toBe(-1);
    expect(heatStep(-0.99)).toBe(-2);
    expect(heatStep(-2.78)).toBe(-3);
    expect(heatStep(-31)).toBe(-4);
  });

  it("separates the moves the old linear tint could not (+2.78% vs +11.04%)", () => {
    expect(heatStep(2.78)).not.toBe(heatStep(11.04));
    expect(heatStep(0.01)).toBe(0);
  });

  it("uses the edges it documents", () => {
    expect([...HEAT_EDGES]).toEqual([0.1, 0.75, 1.75, 3.5]);
    expect(HEAT_STEPS).toHaveLength(9);
  });
});

describe("heatStyle", () => {
  it("maps flat to the flat tile", () => {
    expect(heatStyle(0)).toEqual({ background: "var(--heat-flat)", color: "var(--heat-fg)" });
  });

  it("uses semantic up/down tokens, so the red-up and color-blind conventions swap them in CSS", () => {
    expect(heatStyle(2)).toEqual({ background: "var(--heat-up-2)", color: "var(--heat-fg)" });
    expect(heatStyle(-3)).toEqual({ background: "var(--heat-down-3)", color: "var(--heat-fg)" });
    for (const step of HEAT_STEPS) {
      expect(heatStyle(step).background).not.toMatch(/green|red|blue|orange/);
    }
  });

  it("switches to the strong text color on the outer steps", () => {
    expect(heatStyle(4)).toEqual({ background: "var(--heat-up-4)", color: "var(--heat-fg-strong)" });
    expect(heatStyle(-4)).toEqual({ background: "var(--heat-down-4)", color: "var(--heat-fg-strong)" });
  });
});

describe("directionOf", () => {
  it("reads the sign of a change", () => {
    expect(directionOf(1.2)).toBe("up");
    expect(directionOf(-0.01)).toBe("down");
    expect(directionOf(0)).toBe("flat");
    expect(directionOf(null)).toBe("flat");
    expect(directionOf(Number.NaN)).toBe("flat");
  });
});

describe("withTrueMinus", () => {
  it("replaces a leading hyphen with U+2212", () => {
    expect(withTrueMinus("-0.52%")).toBe("−0.52%");
    expect(withTrueMinus("-12.35")).toBe("−12.35");
  });

  it("leaves other text alone", () => {
    expect(withTrueMinus("+1.35%")).toBe("+1.35%");
    expect(withTrueMinus("0.00%")).toBe("0.00%");
    expect(withTrueMinus("—")).toBe("—");
    expect(withTrueMinus("1-2")).toBe("1-2");
  });
});

describe("shownValue", () => {
  it("rounds a percent or a ratio as its text does and keeps a price change as it is", () => {
    expect(shownValue(-0.0027, "percent")).toBe(0);
    expect(shownValue(0.004, "percent")).toBe(0);
    expect(shownValue(-0.006, "percent")).toBe(-0.01);
    expect(shownValue(0.04, "percent", 1)).toBe(0);
    expect(shownValue(-0.0004, "ratio", 1)).toBe(0);
    expect(shownValue(-0.0123, "ratio", 1)).toBe(-1.2);
    expect(shownValue(-0.00001, "change")).toBe(-0.00001);
    expect(shownValue(null, "percent")).toBeNull();
    expect(shownValue(Number.NaN, "change")).toBeNull();
  });
});

describe("Delta", () => {
  /** What a Delta shows: the direction of its color, of its arrow and of its text's sign. */
  function shown(props: ComponentProps<typeof Delta>): { text: string; color: string; arrow: string; sign: string } {
    const markup = renderToStaticMarkup(createElement(Delta, { ...props, arrow: true }));
    const tone = /text-(up|down|fg-3)\b/.exec(markup)?.[1];
    const arrow = markup.includes("▲") ? "up" : markup.includes("▼") ? "down" : "flat";
    const text = markup.replace(/<span aria-hidden[^>]*>[▲▼]<\/span>/, "").replace(/<[^>]+>/g, "");
    const sign = text.startsWith("+") ? "up" : text.startsWith("−") ? "down" : "flat";
    return { text, color: tone === "fg-3" ? "flat" : (tone ?? "none"), arrow, sign };
  }

  it("colors and points a figure by the sign it shows, so one that rounds to zero is flat", () => {
    const cases: Array<ComponentProps<typeof Delta>> = [
      { value: -0.0027 },
      { value: 0.004 },
      { value: -0.006 },
      { value: 0 },
      { value: 1.234 },
      { value: -12.5 },
      { value: null },
      { value: 0.04, digits: 1 },
      { value: -0.06, digits: 1 },
      { value: -0.0004, kind: "ratio", digits: 1 },
      { value: 0.0123, kind: "ratio" },
      { value: -0.004, kind: "change" },
      { value: 0.00001, kind: "change" },
      { value: 1.8, kind: "change" },
      { value: 0, kind: "change" },
    ];
    for (const props of cases) {
      const { text, color, arrow, sign } = shown(props);
      expect({ color, arrow }, `${JSON.stringify(props)} shows ${text}`).toEqual({ color: sign, arrow: sign });
    }
    // The Energy sector of the README's overview image, down 0.0027%.
    expect(shown({ value: -0.0027 })).toEqual({ text: "0.00%", color: "flat", arrow: "flat", sign: "flat" });
    expect(shown({ value: -0.006 })).toEqual({ text: "−0.01%", color: "down", arrow: "down", sign: "down" });
  });
});
