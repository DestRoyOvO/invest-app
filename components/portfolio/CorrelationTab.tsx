"use client";

import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { withTrueMinus } from "@/components/ui/Delta";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { HIGH_CORRELATION, type RiskReport } from "@/lib/portfolio-analytics";

/** Signed correlation with two decimals and a true minus. */
function signed(r: number): string {
  return withTrueMinus(r.toFixed(2));
}

/**
 * Design-system color rule 6: a signed reading that is not a price shades by magnitude only, on one neutral ramp
 * (info mixed into the panel at |r| x 40%), and prints the signed number in --fg. Never red and green.
 */
export function correlationShade(r: number | null): string | undefined {
  if (r === null) return undefined;
  const n = Math.round(Math.min(1, Math.abs(r)) * 40);
  return `color-mix(in oklab, var(--info) ${n}%, var(--panel))`;
}

/** The n x n correlation heatmap of the analyzed holdings, and the pairs that move together. */
export function CorrelationTab({ report }: { report: RiskReport }) {
  const { t } = usePrefs();
  const c = t.port.correlation;
  const { symbols, matrix, high, average } = report.correlation;

  if (symbols.length < 2) return <p className="px-3 py-6 text-sm text-fg-2">{c.needTwo}</p>;

  return (
    <div>
      <div className="overflow-x-auto">
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
                      title={r === null ? undefined : tpl(c.cell, { a: row, b: col, r: signed(r) })}
                      className={cn("num h-9 min-w-12 border border-panel px-1 text-center", diagonal ? "bg-panel-2 text-fg-3" : "text-fg", strong && "font-semibold")}
                      style={diagonal ? undefined : { background: correlationShade(r) }}
                    >
                      {diagonal ? "1" : r === null ? "—" : signed(r)}
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
                <span className="num text-fg">{signed(pair.r)}</span>
                <span className="text-fg-2">{c.moveTogether}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        {average !== null ? <p>{tpl(c.average, { r: signed(average) })}</p> : null}
        <p>{tpl(c.note, { n: report.sessions })}</p>
      </div>
    </div>
  );
}
