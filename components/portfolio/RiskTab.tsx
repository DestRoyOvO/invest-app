"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { withTrueMinus } from "@/components/ui/Delta";
import { stockPath } from "@/lib/api-client";
import { formatRatio, formatSigned, tpl } from "@/lib/format";
import { displayName } from "@/lib/names-zh";
import { largestRiskGap, type PositionRisk, type RiskReport } from "@/lib/portfolio-analytics";
import type { Quote } from "@/types/api";

/** Weight and share of risk side by side: two neutral bars on one track, with the numbers printed beside them. */
function RiskBars({ weight, risk }: { weight: number; risk: number | null }) {
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <span aria-hidden className="block w-full space-y-0.5">
      <span className="relative block h-1 bg-line-2">
        <span className="absolute inset-y-0 left-0 bg-fg-3" style={{ width: pct(weight) }} />
      </span>
      <span className="relative block h-1 bg-line-2">{risk !== null ? <span className="absolute inset-y-0 left-0 bg-info" style={{ width: pct(risk) }} /> : null}</span>
    </span>
  );
}

interface RiskTabProps {
  report: RiskReport;
  quotes: ReadonlyMap<string, Quote>;
  /** Base-currency positions in the portfolio; more than the analyzed ones means weights here are of a subset. */
  positions: number;
}

/** Each analyzed position's weight, share of risk, beta and volatility over the same sessions. */
export function RiskTab({ report, quotes, positions }: RiskTabProps) {
  const { t, lang } = usePrefs();
  const r = t.port.risk;
  const gap = largestRiskGap(report.positions);
  const pct = (v: number | null, digits = 1) => withTrueMinus(formatRatio(v, { digits }));
  const pts = (p: PositionRisk) => (p.riskShare === null ? null : (p.riskShare - p.weight) * 100);

  const columns: DataTableColumn<PositionRisk>[] = [
    { key: "symbol", header: t.columns.symbol, width: "5.5rem", sortValue: (p) => p.symbol, render: (p) => <span className="mono font-medium text-fg">{p.symbol}</span> },
    {
      key: "name",
      header: t.columns.name,
      hideBelow: "lg",
      render: (p) => (
        <span className="truncate text-fg-2" title={quotes.get(p.symbol)?.name}>
          {displayName(p.symbol, quotes.get(p.symbol)?.name, lang) ?? ""}
        </span>
      ),
    },
    { key: "weight", header: r.weight, align: "right", width: "5.5rem", sortValue: (p) => p.weight, render: (p) => <span className="num text-fg">{pct(p.weight)}</span> },
    { key: "risk", header: r.shareOfRisk, align: "right", width: "8.25rem", sortValue: (p) => p.riskShare, render: (p) => <span className="num text-fg">{pct(p.riskShare)}</span> },
    {
      key: "bars",
      header: <span className="sr-only">{`${r.weight} / ${r.shareOfRisk}`}</span>,
      hideBelow: "sm",
      render: (p) => <RiskBars weight={p.weight} risk={p.riskShare} />,
    },
    {
      key: "gap",
      header: r.gap,
      align: "right",
      width: "8rem",
      hideBelow: "md",
      sortValue: pts,
      render: (p) => {
        const v = pts(p);
        return <span className="num text-fg-2">{v === null ? "—" : withTrueMinus(formatSigned(v, 1, lang))}</span>;
      },
    },
    { key: "beta", header: r.beta, align: "right", width: "4.5rem", sortValue: (p) => p.beta, render: (p) => <span className="num text-fg-2">{p.beta === null ? "—" : withTrueMinus(p.beta.toFixed(2))}</span> },
    { key: "vol", header: r.volatility, align: "right", width: "6.75rem", hideBelow: "sm", sortValue: (p) => p.volatility, render: (p) => <span className="num text-fg-2">{pct(p.volatility)}</span> },
  ];

  return (
    <div>
      {gap ? (
        <p className="border-b border-line px-3 py-2.5 text-sm text-fg">
          {tpl(r.sentence, { symbol: gap.symbol, weight: pct(gap.weight, 0), risk: pct(gap.riskShare, 0) })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pt-2 text-xs text-fg-3" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-4 bg-fg-3" />
          {r.weight}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-4 bg-info" />
          {r.shareOfRisk}
        </span>
      </div>
      <DataTable
        rows={report.positions}
        columns={columns}
        rowKey={(p) => p.symbol}
        caption={r.title}
        defaultSort={{ key: "risk", direction: "desc" }}
        rowHref={(p) => stockPath(p.symbol)}
      />
      <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        {report.symbols.length < positions ? <p>{tpl(r.weightNote, { n: report.symbols.length })}</p> : null}
        <p>{r.note}</p>
      </div>
    </div>
  );
}
