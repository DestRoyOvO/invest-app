import { Fragment, type ReactNode } from "react";

import type { Lang } from "@/types/api";

const LETTER = /[A-Za-z]/;
/** Characters that tie a t or p to a word when they come right before it ("it", "don't", "2p"). */
const JOINS_BEFORE = /[A-Za-z0-9'’]/;
/** Characters that tie a t or p to a word when they come right after it ("to", "p's"). */
const JOINS_AFTER = /[A-Za-z'’]/;

/**
 * True for a statistical symbol that CSS uppercase must not change: the small sigma ("±1Σ" reads as a sum), and t, p
 * and h as letters of their own ("NW t", "One-sided p", "lag 2h"; "T, LAG 2H" reads like hours). Letters inside words
 * are left alone, so "Stock-days" or "don't" never match.
 */
function isSymbolAt(text: string, i: number): boolean {
  const char = text[i];
  const before = text[i - 1] ?? "";
  const after = text[i + 1] ?? "";
  if (char === "σ") return true;
  if (char === "t" || char === "p") return !JOINS_BEFORE.test(before) && !JOINS_AFTER.test(after);
  if (char === "h") return /\d/.test(before) && !LETTER.test(after);
  return false;
}

/** Text for an uppercase role (.col-head, .panel-title) with its statistical symbols kept lowercase (see isSymbolAt). */
export function keepSymbols(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!isSymbolAt(text, i)) continue;
    if (i > start) parts.push(<Fragment key={`t${start}`}>{text.slice(start, i)}</Fragment>);
    parts.push(
      <span key={`s${i}`} className="normal-case">
        {text[i]}
      </span>,
    );
    start = i + 1;
  }
  if (parts.length === 0) return text;
  if (start < text.length) parts.push(<Fragment key={`t${start}`}>{text.slice(start)}</Fragment>);
  return parts;
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
