import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { interpolate, keepSigma, listNodes } from "./text";

const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));
const mono = (text: string) => createElement("span", { className: "mono" }, text);

describe("text helpers", () => {
  it("keeps sigma lowercase inside uppercase roles", () => {
    expect(html(keepSigma("Inside ±1σ"))).toBe('Inside ±1<span class="normal-case">σ</span>');
    expect(keepSigma("Stock-days")).toBe("Stock-days");
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
