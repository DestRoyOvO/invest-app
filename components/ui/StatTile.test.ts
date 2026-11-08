import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatTile } from "./StatTile";

// Server-rendered markup of StatTile: a group named by its label, so assistive technology announces which figure it
// enters and the end-to-end specs find a tile by its name (getByRole("group", { name })).

/** Each group's labelledby id and the id and text of the element it points at. */
function groups(markup: string) {
  return [...markup.matchAll(/<div role="group" aria-labelledby="([^"]+)" class="[^"]*"><div id="([^"]+)" class="col-head truncate">([\s\S]*?)<\/div>/g)].map(
    ([, labelledBy, id, label]) => ({ labelledBy, id, label }),
  );
}

describe("StatTile", () => {
  it("is a group labelled by its column-head label", () => {
    const markup = renderToStaticMarkup(createElement(StatTile, { label: "Unrealized P&L", value: "+1,234.00", sub: "Cost basis 9,000.00" }));
    const [tile] = groups(markup);
    expect(tile).toBeDefined();
    expect(tile.labelledBy).toBe(tile.id);
    expect(tile.label).toBe("Unrealized P&amp;L");
    // The figure and the sub-line stay inside the group, after the label.
    expect(markup.indexOf("+1,234.00")).toBeGreaterThan(markup.indexOf("Unrealized"));
    expect(markup.endsWith("Cost basis 9,000.00</div></div>")).toBe(true);
  });

  it("gives every tile of a strip its own label id", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(StatTile, { label: "Beta", value: "1.08" }),
        createElement(StatTile, { label: "Volatility", value: "18.2%" }),
        createElement(StatTile, { label: "Beta", value: "0.95" }),
      ),
    );
    const tiles = groups(markup);
    expect(tiles.map((tile) => tile.label)).toEqual(["Beta", "Volatility", "Beta"]);
    for (const tile of tiles) expect(tile.labelledBy).toBe(tile.id);
    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(3);
  });

  it("takes a label with markup, such as an abbreviation with a title", () => {
    const label = createElement("span", { title: "Average change" }, "Avg");
    const [tile] = groups(renderToStaticMarkup(createElement(StatTile, { label, value: "+0.42%" })));
    expect(tile.label).toBe('<span title="Average change">Avg</span>');
  });
});
