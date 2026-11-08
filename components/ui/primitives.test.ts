import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DASH } from "@/lib/format";

import { Button, IconButton, PHONE_TARGET } from "./Button";
import { DataTable, type DataTableColumn } from "./DataTable";
import { Input } from "./Field";
import { Panel } from "./Panel";
import { Segmented } from "./Segmented";
import { Select } from "./Select";
import { Tabs } from "./Tabs";
import { TickNumber } from "./TickNumber";
import { Whisker } from "./Whisker";

// Server-rendered markup of the primitives: the classes and attributes that carry the design-system rules. DataTable
// reads the app router and the messages, which only exist inside the app.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { useT: () => MESSAGES.en, usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});

const html = (node: ReactNode) => renderToStaticMarkup(node);
/** The class tokens of every element whose opening tag matches `tag` (a regex source such as `button[^>]*role="tab"`). */
const classTokens = (markup: string, tag: string) =>
  [...markup.matchAll(new RegExp(`<${tag}[^>]*?class="([^"]*)"`, "g"))].map((match) => match[1].split(" "));

describe("phone touch targets", () => {
  it("are a 40px minimum height below sm", () => {
    expect(PHONE_TARGET).toBe("max-sm:min-h-10");
  });

  it("are built into Button at both sizes, and touchTarget={false} keeps the desktop height", () => {
    for (const size of ["sm", "md"] as const) {
      const height = size === "sm" ? "h-7" : "h-8";
      const [on] = classTokens(html(createElement(Button, { size }, "Retry")), "button");
      expect(on).toContain(PHONE_TARGET);
      expect(on).toContain(height);
      const [off] = classTokens(html(createElement(Button, { size, touchTarget: false }, "Retry")), "button");
      expect(off).not.toContain(PHONE_TARGET);
      expect(off).toContain(height);
    }
  });

  it("make IconButton 40px square below sm at both sizes", () => {
    for (const size of ["sm", "md"] as const) {
      const [tokens] = classTokens(html(createElement(IconButton, { size, label: "Close", icon: "x" })), "button");
      expect(tokens).toContain("max-sm:size-10");
    }
  });

  it("are built into every Segmented segment, every tab, Select and Input", () => {
    const options = [
      { value: "a", label: "One" },
      { value: "b", label: "Two" },
    ];
    const noop = () => undefined;
    const segments = classTokens(html(createElement(Segmented, { label: "Pick", value: "a", options, onChange: noop, size: "sm" })), 'button[^>]*role="radio"');
    const tabs = classTokens(html(createElement(Tabs, { label: "Views", value: "a", options, onChange: noop })), 'button[^>]*role="tab"');
    const selects = classTokens(html(createElement(Select, { size: "sm", "aria-label": "Range" }, createElement("option", null, "1M"))), "select");
    const inputs = classTokens(html(createElement(Input, { size: "sm", "aria-label": "Symbol" })), "input");
    expect(segments).toHaveLength(2);
    expect(tabs).toHaveLength(2);
    expect(selects).toHaveLength(1);
    expect(inputs).toHaveLength(1);
    for (const tokens of [...segments, ...tabs, ...selects, ...inputs]) expect(tokens).toContain(PHONE_TARGET);
  });
});

describe("Panel", () => {
  it("has a minimum header height, so a 40px phone control grows the header instead of covering its hairline", () => {
    // Children go in as the third argument; createElement's typing wants them in the props too.
    const props: Omit<ComponentProps<typeof Panel>, "children"> = { title: "Rules", code: "ALRT", actions: createElement(Button, { size: "sm" }, "New alert") };
    const markup = html(createElement(Panel, props as ComponentProps<typeof Panel>, "body"));
    const [header] = classTokens(markup, "header");
    expect(header).toContain("min-h-9");
    expect(header).not.toContain("h-9");
  });
});

describe("Whisker", () => {
  const props = { estimate: 0.6, low: 0.56, high: 0.64, base: 0.5, min: 0.3, max: 0.7, label: "Hit rate 60%, interval 56 to 64%, base 50%" };

  it("turns the dot accent when the interval excludes the base rate", () => {
    expect(html(createElement(Whisker, props))).toMatch(/<circle[^>]*fill="var\(--accent\)"/);
  });

  it("greys the interval and the dot with neutral, never accent", () => {
    const markup = html(createElement(Whisker, { ...props, neutral: true }));
    expect(markup).toMatch(/<circle[^>]*fill="var\(--fg-3\)"/);
    expect(markup).not.toContain("var(--accent)");
    expect(markup).not.toContain("var(--fg-2)");
    expect(markup).toContain(`aria-label="${props.label}"`);
  });
});

describe("TickNumber", () => {
  const text = (value: number | null | undefined, children?: ReactNode) => html(createElement(TickNumber, { value }, children)).replace(/<[^>]+>/g, "");

  it("falls back to DASH for a missing or non-finite value", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(text(value)).toBe(DASH);
  });

  it("shows the raw value, or the formatted children when given", () => {
    expect(text(12.5)).toBe("12.5");
    expect(text(0)).toBe("0");
    expect(text(12.5, "12.50")).toBe("12.50");
  });
});

describe("DataTable", () => {
  interface Row {
    symbol: string;
    price: number | null;
  }
  const rows: Row[] = [
    { symbol: "AAPL", price: 270.1 },
    { symbol: "MSFT", price: null },
  ];
  const columns: DataTableColumn<Row>[] = [
    { key: "symbol", header: "Symbol", render: (row) => row.symbol },
    { key: "last", header: "Last", align: "right", render: (row) => row.price ?? DASH, sortValue: (row) => row.price },
  ];
  const table = (props: { rowHover?: boolean; stickyHeader?: boolean; maxHeight?: string } = {}) =>
    html(createElement(DataTable<Row>, { rows, columns, rowKey: (row) => row.symbol, caption: "Quotes", ...props }));
  // Only body rows carry a class; the head row has none.
  const bodyRows = (markup: string) => classTokens(markup, "tr");

  it("highlights rows on hover unless rowHover is false", () => {
    expect(bodyRows(table())).toHaveLength(2);
    for (const tokens of bodyRows(table())) expect(tokens).toContain("hover:bg-hover");
    expect(bodyRows(table({ rowHover: false }))).toHaveLength(2);
    expect(table({ rowHover: false })).not.toContain("hover:bg-hover");
  });

  it("renders the scroll box positioned and without a tab stop until it is measured overflowing", () => {
    const box = table({ maxHeight: "10rem", stickyHeader: true }).match(/^<div([^>]*)>/)?.[1] ?? "";
    expect(box).toContain("relative");
    expect(box).toContain("overflow-auto");
    expect(box).not.toContain("role=");
    expect(box).not.toContain("tabindex");
    expect(box).not.toContain("aria-label");
  });

  it("draws the region's focus ring inside the box, or just outside it under a sticky header", () => {
    const [plain] = classTokens(table(), "div");
    expect(plain).toContain("focus-visible:outline-offset-[-2px]");
    expect(plain).not.toContain("focus-visible:outline-offset-0");
    const [sticky] = classTokens(table({ maxHeight: "10rem", stickyHeader: true }), "div");
    expect(sticky).toContain("focus-visible:outline-offset-0");
    expect(sticky).not.toContain("focus-visible:outline-offset-[-2px]");
  });

  it("captions the table for screen readers and makes a sortable head a button", () => {
    const markup = table();
    expect(markup).toContain('<caption class="sr-only">Quotes</caption>');
    expect(markup).toMatch(/<th scope="col"[^>]*><button type="button"/);
  });
});
