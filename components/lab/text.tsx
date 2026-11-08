import { Fragment, type ReactNode } from "react";

import type { Lang } from "@/types/api";

/**
 * Statistical symbols that CSS uppercase must not change: the small sigma ("±1Σ" reads as a sum), and t, p and h as
 * letters of their own ("NW t", "One-sided p", "lag 2h"; "T, LAG 2H" reads like hours). Letters inside words are left
 * alone, so "Stock-days" or "don't" never match.
 */
const KEEP_CASE = /(σ|(?<![A-Za-z0-9'’])[tp](?![A-Za-z'’])|(?<=\d)h(?![A-Za-z]))/;

/** Text for an uppercase role (.col-head, .panel-title) with its statistical symbols kept lowercase (see KEEP_CASE). */
export function keepSymbols(text: string): ReactNode {
  const parts = text.split(KEEP_CASE);
  if (parts.length === 1) return text;
  // split() with a capturing group puts the matched symbols at the odd indexes.
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="normal-case">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** tpl() for React nodes: replaces {name} placeholders with nodes, e.g. a ticker in mono inside a sentence. */
export function interpolate(template: string, values: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key !== undefined && key in values ? values[key] : part}</Fragment>;
  });
}

/** Nodes joined as a list in the reader's language ("A, B, and C" / "A、B和C"), like joinList() for strings. */
export function listNodes(items: readonly ReactNode[], lang: Lang): ReactNode {
  const formatter = new Intl.ListFormat(lang === "zh" ? "zh-CN" : "en-US", { style: "long", type: "conjunction" });
  return formatter.formatToParts(items.map((_, i) => `#${i}#`)).map((part, k) => {
    const index = part.type === "element" ? Number(part.value.slice(1, -1)) : -1;
    return <Fragment key={k}>{index >= 0 ? items[index] : part.value}</Fragment>;
  });
}
