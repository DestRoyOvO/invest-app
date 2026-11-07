"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { IconButton } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, SkeletonRows } from "@/components/ui/States";
import { stockPath } from "@/lib/api-client";
import { formatNumber, formatPrice, formatRatio, signOf, tpl } from "@/lib/format";
import type { Portfolio, PositionLike, ValuedPosition } from "@/lib/portfolio";
import type { Lang } from "@/types/api";

function Money({ value, lang, signed = false }: { value: number | null; lang: Lang; signed?: boolean }) {
  if (value === null) return <span className="num text-fg-3">—</span>;
  const sign = signOf(value);
  const text = formatNumber(Math.abs(value), 2, lang);
  if (!signed) return <span className="num text-fg">{text}</span>;
  return <span className={`num ${sign > 0 ? "text-up" : sign < 0 ? "text-down" : "text-fg-3"}`}>{`${sign > 0 ? "+" : sign < 0 ? "−" : ""}${text}`}</span>;
}

interface PositionsPanelProps {
  portfolio: Portfolio;
  /** Quotes are still loading, so the positions cannot be valued yet. */
  loading: boolean;
  onEdit: (symbol: string) => void;
  className?: string;
}

export function PositionsPanel({ portfolio, loading, onEdit, className }: PositionsPanelProps) {
  const { t, lang } = usePrefs();
  const p = t.portfolio;
  const th = "col-head h-8 px-3 text-right whitespace-nowrap";
  const { rows, foreign, unpriced, totals, baseCurrency } = portfolio;
  const count = rows.length + foreign.length + unpriced.length;

  const shares = (value: number) => formatNumber(value, value % 1 === 0 ? 0 : 4, lang);
  const symbolCell = (symbol: string, currency?: string) => (
    <td className="h-row px-3 whitespace-nowrap">
      <Link href={stockPath(symbol)} className="mono font-medium text-fg hover:text-accent">
        {symbol}
      </Link>
      {currency ? <span className="mono ml-1.5 text-xs text-fg-3">{currency}</span> : null}
    </td>
  );
  const editCell = (symbol: string) => (
    <td className="pr-2 text-right">
      <IconButton size="sm" label={tpl(p.editShort, { symbol })} icon={<Pencil className="size-3.5" strokeWidth={1.75} />} onClick={() => onEdit(symbol)} />
    </td>
  );

  const valuedRow = (row: ValuedPosition, showCurrency: boolean) => (
    <tr key={row.symbol} className="border-b border-line/70 hover:bg-hover">
      {symbolCell(row.symbol, showCurrency ? row.currency : undefined)}
      <td className="num px-3 text-right text-fg-2">{shares(row.shares)}</td>
      <td className="num px-3 text-right text-fg-2">{formatPrice(row.cost, lang)}</td>
      <td className="num px-3 text-right text-fg">{formatPrice(row.price, lang)}</td>
      <td className="px-3 text-right">
        <Money value={row.value} lang={lang} />
      </td>
      <td className="num px-3 text-right text-fg-2">{row.weight === null ? "—" : formatRatio(row.weight)}</td>
      <td className="px-3 text-right">
        <Money value={row.dayPnl} lang={lang} signed />
      </td>
      <td className="px-3 text-right whitespace-nowrap">
        <Money value={row.pnl} lang={lang} signed /> <Delta value={row.pnlPct} kind="ratio" digits={1} className="text-xs" />
      </td>
      {editCell(row.symbol)}
    </tr>
  );

  const unpricedRow = (position: PositionLike) => (
    <tr key={position.symbol} className="border-b border-line/70 hover:bg-hover">
      {symbolCell(position.symbol)}
      <td className="num px-3 text-right text-fg-2">{shares(position.shares)}</td>
      <td className="num px-3 text-right text-fg-2">{formatPrice(position.cost, lang)}</td>
      <td colSpan={5} className="px-3 text-right text-xs text-fg-3">
        {p.noQuote}
      </td>
      {editCell(position.symbol)}
    </tr>
  );

  return (
    <Panel title={p.title} actions={count ? <PanelMeta>{p.storedLocally}</PanelMeta> : null} className={className}>
      {loading ? (
        <SkeletonRows rows={Math.min(Math.max(count, 2), 6)} />
      ) : count === 0 ? (
        <EmptyState>{p.empty}</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-data">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="col-head h-8 px-3 text-left">
                    {t.columns.symbol}
                  </th>
                  <th scope="col" className={th}>{p.shares}</th>
                  <th scope="col" className={th}>{p.avgCost}</th>
                  <th scope="col" className={th}>{t.columns.last}</th>
                  <th scope="col" className={th}>{p.value}</th>
                  <th scope="col" className={th}>{p.weight}</th>
                  <th scope="col" className={th}>{p.dayPnl}</th>
                  <th scope="col" className={th}>{p.pnl}</th>
                  <th scope="col" className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => valuedRow(row, false))}
                {foreign.map((row) => valuedRow(row, true))}
                {unpriced.map(unpricedRow)}
              </tbody>
              {rows.length > 0 ? (
                <tfoot>
                  <tr className="bg-panel-2">
                    <th scope="row" className="col-head h-9 px-3 text-left whitespace-nowrap">
                      {p.total} · {baseCurrency}
                    </th>
                    <td colSpan={3} />
                    <td className="px-3 text-right">
                      <Money value={totals.value} lang={lang} />
                    </td>
                    <td className="num px-3 text-right text-fg-2">{formatRatio(1)}</td>
                    <td className="px-3 text-right">
                      <Money value={totals.dayPnl} lang={lang} signed />
                    </td>
                    <td className="px-3 text-right whitespace-nowrap">
                      <Money value={totals.pnl} lang={lang} signed /> <Delta value={totals.pnlPct} kind="ratio" digits={1} className="text-xs" />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          {foreign.length > 0 || unpriced.length > 0 ? (
            <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
              {foreign.length > 0 ? <p>{tpl(p.foreignNote, { currency: baseCurrency })}</p> : null}
              {unpriced.length > 0 ? <p>{p.unpricedNote}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
