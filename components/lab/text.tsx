import { Fragment, type ReactNode } from "react";

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
