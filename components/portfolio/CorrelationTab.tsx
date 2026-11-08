"use client";

import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { plural } from "@/lib/i18n/plural";
import { HIGH_CORRELATION, type RiskReport } from "@/lib/portfolio-analytics";

import { correlationShade, formatCorrelation } from "./correlation-format";

/**
 * The n x n correlation heatmap of the analyzed holdings, and the pairs that move together. The matrix scrolls
 * sideways when it is wider than the panel (phones, or many holdings), so its scroller is a focusable, named region
 * that keyboard users can scroll with the arrow keys.
 */
export function CorrelationTab({ report }: { report: RiskReport }) {
  const { t } = usePrefs();
  const c = t.port.correlation;
  const { symbols, matrix, high, average } = report.correlation;

  if (symbols.length < 2) return <p className="px-3 py-6 text-sm text-fg-2">{c.needTwo}</p>;

  return (
    <div>
      <div role="region" aria-label={c.title} tabIndex={0} className="overflow-x-auto focus-visible:outline-offset-[-2px]">
        <table className="border-collapse text-xs">
          <caption className="sr-only">{c.title}</caption>
          <thead>
            <tr>
              <td className="sticky left-0 z-10 bg-panel" />
              {symbols.map((s) => (
                <th key={s} scope="col" className="mono h-8 min-w-12 px-1 text-center font-medium text-fg-2">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((row, i) => (
              <tr key={row}>
                <th scope="row" className="mono sticky left-0 z-10 h-9 bg-panel pr-2 pl-3 text-left font-medium text-fg-2">
                  {row}
                </th>
                {symbols.map((col, j) => {
                  const r = matrix[i][j];
                  const diagonal = i === j;
                  const strong = !diagonal && r !== null && r >= HIGH_CORRELATION;
                  return (
                    <td
                      key={col}
                      title={r === null ? undefined : tpl(c.cell, { a: row, b: col, r: formatCorrelation(r) })}
                      className={cn("num h-9 min-w-12 border border-panel px-1 text-center", diagonal ? "bg-panel-2 text-fg-3" : "text-fg", strong && "font-semibold")}
                      style={diagonal ? undefined : { background: correlationShade(r) }}
                    >
                      {diagonal ? "1" : r === null ? "—" : formatCorrelation(r)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-3 py-3">
        <h3 className="col-head">{c.high}</h3>
        {high.length === 0 ? (
          <p className="mt-1.5 text-sm text-fg-2">{c.none}</p>
        ) : (
          <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {high.map((pair) => (
              <li key={`${pair.a}-${pair.b}`} className="flex items-center gap-2">
                <Link href={stockPath(pair.a)} className="mono font-medium text-fg hover:text-accent">
                  {pair.a}
                </Link>
                <span className="text-fg-3">·</span>
                <Link href={stockPath(pair.b)} className="mono font-medium text-fg hover:text-accent">
                  {pair.b}
                </Link>
                <span className="num text-fg">{formatCorrelation(pair.r)}</span>
                <span className="text-fg-2">{c.moveTogether}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        {average !== null ? <p>{tpl(c.average, { r: formatCorrelation(average) })}</p> : null}
        <p>{plural(c.note, report.sessions)}</p>
      </div>
    </div>
  );
}
