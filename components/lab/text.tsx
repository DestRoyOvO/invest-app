import { Fragment, type ReactNode } from "react";

import type { Lang } from "@/types/api";

/**
 * Text for an uppercase role (.col-head, .panel-title) that keeps the Greek small sigma lowercase: CSS uppercase would
 * turn "±1σ" into "±1Σ", which reads as a sum.
 */
export function keepSigma(text: string): ReactNode {
  if (!text.includes("σ")) return text;
  const parts = text.split("σ");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 ? <span className="normal-case">{"σ"}</span> : null}
    </Fragment>
  ));
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
