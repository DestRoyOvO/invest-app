import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { interpolate, keepSymbols, listNodes } from "./text";

const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));
const mono = (text: string) => createElement("span", { className: "mono" }, text);

describe("text helpers", () => {
  it("keeps sigma lowercase inside uppercase roles", () => {
    expect(html(keepSymbols("Inside ±1σ"))).toBe('Inside ±1<span class="normal-case">σ</span>');
    expect(keepSymbols("Stock-days")).toBe("Stock-days");
  });

  it("keeps t, p and h lowercase when they stand alone as statistical letters", () => {
    const lower = (s: string) => `<span class="normal-case">${s}</span>`;
    expect(html(keepSymbols("NW t"))).toBe(`NW ${lower("t")}`);
    expect(html(keepSymbols("t, lag 2h"))).toBe(`${lower("t")}, lag 2${lower("h")}`);
    expect(html(keepSymbols("One-sided p"))).toBe(`One-sided ${lower("p")}`);
    expect(html(keepSymbols("p"))).toBe(lower("p"));
    expect(html(keepSymbols("Rank IC (Newey-West t) by subperiod"))).toBe(`Rank IC (Newey-West ${lower("t")}) by subperiod`);
    expect(html(keepSymbols("t 值（2h 滞后）"))).toBe(`${lower("t")} 值（2${lower("h")} 滞后）`);
    expect(html(keepSymbols("Holm p 值"))).toBe(`Holm ${lower("p")} 值`);
  });

  it("leaves letters inside words alone", () => {
    for (const text of ["Turnover", "Hold", "Q5 − Q1", "don't", "Trades", "Spearman", "IC sd", "Holm"]) expect(keepSymbols(text)).toBe(text);
  });

  it("interpolates nodes into a template and leaves unknown placeholders alone", () => {
    expect(html(interpolate("{symbol} is not one of the {n}.", { symbol: mono("SPY"), n: 78 }))).toBe('<span class="mono">SPY</span> is not one of the 78.');
    expect(html(interpolate("Keep {other}", {}))).toBe("Keep {other}");
  });

  it("joins nodes as a list in either language", () => {
    expect(html(listNodes([mono("NVDA"), mono("AMD"), mono("CEG")], "en"))).toBe(
      '<span class="mono">NVDA</span>, <span class="mono">AMD</span>, and <span class="mono">CEG</span>',
    );
    expect(html(listNodes([mono("NVDA"), mono("AMD"), mono("CEG")], "zh"))).toBe(
      '<span class="mono">NVDA</span>、<span class="mono">AMD</span>和<span class="mono">CEG</span>',
    );
  });
});
