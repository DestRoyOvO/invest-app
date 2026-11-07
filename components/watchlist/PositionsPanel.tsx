"use client";

import { ArrowRight, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";

import { LINK_BUTTON } from "@/components/portfolio/MyDayPanel";
import { Money, SignedMoney } from "@/components/portfolio/money";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { DataTable, type Breakpoint, type DataTableColumn } from "@/components/ui/DataTable";
import { Delta } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { useNow } from "@/hooks/usePortfolio";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatPrice, formatRatio, formatShortDate, tpl } from "@/lib/format";
import { extendedHoursPnl, type Portfolio, type ValuedPosition } from "@/lib/portfolio";
import type { Quote } from "@/types/api";

import { earningsBadge, formatShares } from "./format";

interface PositionRow {
  symbol: string;
  kind: "base" | "foreign" | "unpriced";
  shares: number;
  cost: number;
  valued: ValuedPosition | undefined;
  quote: Quote | undefined;
}

// Static class names so Tailwind sees them; footer cells hide together with their columns.
const HIDE_CELL: Record<Breakpoint, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

function extendedPnlOf(row: PositionRow): number | null {
  const q = row.quote;
  return row.valued && q?.extendedSession && typeof q.extendedChange === "number" ? row.shares * q.extendedChange : null;
}

interface PositionsPanelProps {
  portfolio: Portfolio;
  quotes: ReadonlyMap<string, Quote>;
  /** Quotes are still loading, so the positions cannot be valued yet. */
  loading: boolean;
  className?: string;
}

/**
 * The investor's positions on DataTable: value, weight, day P&L, pre-market or after-hours P&L, unrealized P&L and
 * P&L % in separate columns, and the next report. Four columns on phones (symbol and shares, value, day P&L,
 * unrealized). Totals cover the base currency only (lib/portfolio.ts).
 */
export function PositionsPanel({ portfolio, quotes, loading, className }: PositionsPanelProps) {
  const { t, lang } = usePrefs();
  const { openPositionEditor } = useUi();
  const now = useNow();
  const p = t.portfolio;
  const { rows: baseRows, foreign, unpriced, totals, baseCurrency } = portfolio;
  const count = baseRows.length + foreign.length + unpriced.length;
  const extended = extendedHoursPnl(baseRows, (s) => quotes.get(s));
  const extHeader = extended ? (extended.session === "PRE" ? p.extPre : extended.session === "POST" ? p.extPost : p.extMixed) : "";

  const rows = useMemo<PositionRow[]>(
    () => [
      ...baseRows.map((v) => ({ symbol: v.symbol, kind: "base" as const, shares: v.shares, cost: v.cost, valued: v, quote: quotes.get(v.symbol) })),
      ...foreign.map((v) => ({ symbol: v.symbol, kind: "foreign" as const, shares: v.shares, cost: v.cost, valued: v, quote: quotes.get(v.symbol) })),
      ...unpriced.map((u) => ({ symbol: u.symbol, kind: "unpriced" as const, shares: u.shares, cost: u.cost, valued: undefined, quote: quotes.get(u.symbol) })),
    ],
    [baseRows, foreign, unpriced, quotes],
  );

  const columns: DataTableColumn<PositionRow>[] = [
    {
      key: "symbol",
      header: t.columns.symbol,
      width: "5.75rem",
      sortValue: (r) => r.symbol,
      render: (r) => (
        <span className="block min-w-0 py-1">
          <span className="flex items-center gap-1.5">
            <span className="mono font-medium text-fg">{r.symbol}</span>
            {r.kind === "foreign" ? <span className="mono text-xs text-fg-3">{r.valued?.currency}</span> : null}
          </span>
          <span className="num block text-micro text-fg-3 sm:hidden">{tpl(p.sharesShort, { n: formatShares(r.shares, lang) })}</span>
        </span>
      ),
    },
    { key: "shares", header: p.shares, align: "right", width: "4.5rem", hideBelow: "sm", render: (r) => <span className="num text-fg-2">{formatShares(r.shares, lang)}</span> },
    { key: "cost", header: p.avgCost, align: "right", width: "5.25rem", hideBelow: "md", render: (r) => <span className="num text-fg-2">{formatPrice(r.cost, lang)}</span> },
    {
      key: "value",
      header: p.value,
      align: "right",
      width: "6rem",
      sortValue: (r) => r.valued?.value ?? null,
      render: (r) => (r.valued ? <Money value={r.valued.value} lang={lang} /> : <span className="text-xs text-fg-3">{p.noQuote}</span>),
    },
    { key: "weight", header: p.weight, align: "right", width: "4.75rem", hideBelow: "lg", sortValue: (r) => r.valued?.weight ?? null, render: (r) => <span className="num text-fg-2">{formatRatio(r.valued?.weight)}</span> },
    {
      key: "day",
      header: p.dayPnl,
      align: "right",
      width: "6rem",
      sortValue: (r) => r.valued?.dayPnl ?? null,
      render: (r) => (
        <TickNumber value={r.valued?.dayPnl}>
          <SignedMoney value={r.valued?.dayPnl} lang={lang} />
        </TickNumber>
      ),
    },
    ...(extended ? [{ key: "ext", header: extHeader, align: "right" as const, width: "5.5rem", hideBelow: "md" as const, render: (r: PositionRow) => <SignedMoney value={extendedPnlOf(r)} lang={lang} /> }] : []),
    {
      key: "pnl",
      header: p.pnlShort,
      title: p.pnl,
      align: "right",
      width: "6.25rem",
      sortValue: (r) => r.valued?.pnl ?? null,
      render: (r) => (
        <span className="block py-1">
          <SignedMoney value={r.valued?.pnl} lang={lang} className="block" />
          <Delta value={r.valued?.pnlPct} kind="ratio" digits={1} className="block text-micro sm:hidden" />
        </span>
      ),
    },
    { key: "pnlPct", header: p.pnlPct, align: "right", width: "5.25rem", hideBelow: "sm", sortValue: (r) => r.valued?.pnlPct ?? null, render: (r) => <Delta value={r.valued?.pnlPct} kind="ratio" digits={1} /> },
    {
      key: "earnings",
      header: p.nextEr,
      title: p.nextErLong,
      align: "right",
      width: "4.75rem",
      hideBelow: "lg",
      sortValue: (r) => r.quote?.nextEarningsDate ?? null,
      render: (r) => {
        const date = r.quote?.nextEarningsDate;
        if (!date) return <span className="text-fg-3">—</span>;
        const badge = earningsBadge(r.quote, now);
        const day = formatShortDate(date, lang, "America/New_York");
        const title = tpl(r.quote?.earningsDateEstimated ? t.watchlist.erTitleEst : t.watchlist.erTitle, { date: day });
        return (
          <span title={title} className={cn("num", badge?.warn ? "text-warn" : "text-fg-2")}>
            {day}
          </span>
        );
      },
    },
  ];

  const footCells: Record<string, ReactNode> = {
    symbol: (
      <span className="col-head">
        {p.total} · {baseCurrency}
      </span>
    ),
    value: <Money value={totals.value} lang={lang} />,
    weight: <span className="num text-fg-2">{formatRatio(1)}</span>,
    day: <SignedMoney value={totals.dayPnl} lang={lang} />,
    ext: extended ? <SignedMoney value={extended.pnl} lang={lang} /> : null,
    pnl: (
      <span className="block py-1">
        <SignedMoney value={totals.pnl} lang={lang} className="block" />
        <Delta value={totals.pnlPct} kind="ratio" digits={1} className="block text-micro sm:hidden" />
      </span>
    ),
    pnlPct: <Delta value={totals.pnlPct} kind="ratio" digits={1} />,
  };
  const footer =
    baseRows.length > 0 ? (
      <tr className="h-row bg-panel-2">
        {columns.map((col) => (
          <td key={col.key} className={cn("px-3 whitespace-nowrap", col.align === "right" ? "text-right" : "text-left", col.hideBelow && HIDE_CELL[col.hideBelow])}>
            {footCells[col.key] ?? null}
          </td>
        ))}
        <td />
      </tr>
    ) : null;

  return (
    <Panel
      title={p.title}
      code="PORT"
      className={className}
      actions={
        <>
          {count > 0 ? (
            <Link href="/portfolio" className="hidden items-center gap-1 px-1 text-xs text-fg-2 hover:text-fg sm:inline-flex">
              {p.analytics}
              <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.75} />
            </Link>
          ) : null}
          <Button size="sm" onClick={() => openPositionEditor("")} className="max-sm:h-8">
            <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
            {p.addPosition}
          </Button>
        </>
      }
    >
      {count === 0 && !loading ? (
        <EmptyState
          actions={
            <>
              <Button size="sm" onClick={() => openPositionEditor("")} className="max-sm:h-10">
                {p.addPosition}
              </Button>
              <Link href="/data#paste" className={LINK_BUTTON}>
                {p.pastePositions}
              </Link>
            </>
          }
        >
          {p.empty}
        </EmptyState>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.symbol}
          caption={p.title}
          rowHref={(r) => stockPath(r.symbol)}
          rowActions={(r) => <IconButton size="sm" label={tpl(p.editShort, { symbol: r.symbol })} icon={<Pencil className="size-3.5" strokeWidth={1.75} />} onClick={() => openPositionEditor(r.symbol)} />}
          actionsWidth="2.5rem"
          actionsTouchWidth="3.25rem"
          loading={loading}
          loadingRows={Math.min(Math.max(count, 2), 8)}
          footer={footer}
        />
      )}
      <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        {foreign.length > 0 ? <p>{tpl(p.foreignNote, { currency: baseCurrency })}</p> : null}
        {unpriced.length > 0 ? <p>{p.unpricedNote}</p> : null}
        <p>
          {p.storedLocally}{" "}
          <Link href="/data" className="text-fg-2 underline underline-offset-2 hover:text-fg">
            {p.manageData}
          </Link>
        </p>
      </div>
    </Panel>
  );
}
