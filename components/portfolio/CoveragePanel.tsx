"use client";

import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { stockPath } from "@/lib/api-client";
import { formatRatio, tpl } from "@/lib/format";
import type { Portfolio } from "@/lib/portfolio";
import type { RiskReport } from "@/lib/portfolio-analytics";

interface Excluded {
  symbol: string;
  reason: string;
}

interface CoveragePanelProps {
  portfolio: Portfolio;
  report: RiskReport;
  /** Base-currency positions beyond the 24 largest. */
  beyond: readonly string[];
  /** Symbols whose price history failed upstream this time (a degraded /api/history response). */
  failed: readonly string[];
  loading: boolean;
}

/** Which positions the risk statistics cover, and why the others are left out. */
export function CoveragePanel({ portfolio, report, beyond, failed, loading }: CoveragePanelProps) {
  const { t } = usePrefs();
  const c = t.port.coverage;
  const total = portfolio.rows.length + portfolio.foreign.length + portfolio.unpriced.length;
  const excluded: Excluded[] = [
    ...beyond.map((symbol) => ({ symbol, reason: c.beyond })),
    ...(loading ? [] : report.missingHistory.map((symbol) => ({ symbol, reason: failed.includes(symbol) ? c.historyFailed : c.noHistory }))),
    ...portfolio.foreign.map((p) => ({ symbol: p.symbol, reason: tpl(c.otherCurrency, { currency: p.currency }) })),
    ...portfolio.unpriced.map((p) => ({ symbol: p.symbol, reason: c.noQuote })),
  ];
  const analyzed = loading ? portfolio.rows.slice(0, portfolio.rows.length - beyond.length) : portfolio.rows.filter((r) => report.symbols.includes(r.symbol));

  return (
    <Panel title={c.title} actions={<PanelMeta>{tpl(c.count, { n: analyzed.length, m: total })}</PanelMeta>}>
      <ul className="px-3 py-2 text-data">
        {analyzed.map((row) => (
          <li key={row.symbol} className="flex h-7 items-center justify-between gap-3 max-sm:h-10">
            <Link href={stockPath(row.symbol)} className="mono font-medium text-fg hover:text-accent max-sm:inline-flex max-sm:h-10 max-sm:items-center">
              {row.symbol}
            </Link>
            <span className="num text-fg-2">{formatRatio(row.weight)}</span>
          </li>
        ))}
      </ul>
      {excluded.length > 0 ? (
        <div className="border-t border-line px-3 py-2">
          <h3 className="col-head">{c.excluded}</h3>
          <ul className="mt-1 space-y-1 text-xs">
            {excluded.map((item) => (
              <li key={item.symbol} className="flex items-baseline gap-2">
                <span className="mono w-16 shrink-0 font-medium text-fg">{item.symbol}</span>
                <span className="text-fg-3">{item.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

/** How each figure on the page is computed, in plain words. */
export function MethodPanel() {
  const { t } = usePrefs();
  const m = t.port.method;
  return (
    <Panel title={m.title}>
      <ul className="space-y-1.5 px-3 py-3 text-xs text-fg-2">
        {Object.values(m.lines).map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>{t.port.betaNote}</li>
      </ul>
    </Panel>
  );
}
