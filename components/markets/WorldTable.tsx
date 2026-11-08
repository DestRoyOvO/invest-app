"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Delta, directionOf } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { Skeleton } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatNumber, tpl } from "@/lib/format";
import type { WorldSymbol } from "@/lib/universe";
import type { WorldRow } from "@/types/markets";

import { localTradeTime, sessionOf, type SessionKind, type WorldEntry } from "./world";

const DOT: Record<SessionKind, string> = {
  open: "bg-fg",
  pre: "border border-fg-2",
  post: "border border-fg-2",
  closed: "bg-fg-3",
  unknown: "border border-fg-3",
};

/**
 * The session as a word with a small neutral dot (filled while the regular session trades, hollow in extended hours).
 * `quiet` sets it in the meta line of a compact row, a step lighter.
 */
export function SessionLabel({ kind, quiet = false }: { kind: SessionKind; quiet?: boolean }) {
  const { t } = usePrefs();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", DOT[kind])} />
      <span className={kind === "open" ? (quiet ? "text-fg-2" : "text-fg") : quiet ? "text-fg-3" : "text-fg-2"}>{t.markets.session[kind]}</span>
    </span>
  );
}

/** When the last trade happened on the exchange's own clock, with the place for screen readers ("Tokyo time"). */
function TradeTime({ def, row, now, className }: { def: WorldSymbol; row: WorldRow | null; now: number; className?: string }) {
  const { t, lang } = usePrefs();
  return (
    <time dateTime={row?.time ?? undefined} className={cn("num", className)}>
      {localTradeTime(row?.time ?? null, def.timeZone, lang, now)}
      <span className="sr-only"> {tpl(t.markets.localTimeOf, { place: def.place[lang] })}</span>
    </time>
  );
}

interface WorldTableProps {
  entries: WorldEntry[];
  caption: string;
  /**
   * Narrow panels: market (with the session and the local time of the last trade as a second line), last, change % and
   * the 1M line.
   */
  compact?: boolean;
  /** Reference time for "today" in the local trade times: when the server assembled the board. */
  now: number;
  /** No data yet: the instruments are listed with placeholders, so the table keeps its loaded height. */
  loading?: boolean;
}

/**
 * One region of the world board: the instrument, its session and the exchange-local time of the last trade, the
 * price, the change and a neutral one-month line. Rows link to the quote page. Column widths fit the 22rem right-hand
 * column in compact mode and leave the names room in the wide one.
 */
export function WorldTable({ entries, caption, compact = false, now, loading = false }: WorldTableProps) {
  const { t, lang } = usePrefs();
  const placeholder = (className?: string) => <Skeleton className={cn("inline-block h-3.5 align-middle", className)} />;

  const columns: Array<DataTableColumn<WorldEntry> | null> = [
    {
      key: "market",
      header: t.markets.cols.market,
      render: ({ def, row }) =>
        compact ? (
          <span className="block py-0.5">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="mono shrink-0 font-medium text-fg">{def.code}</span>
              <span className="truncate text-fg-2" title={def.label[lang]}>
                {def.label[lang]}
              </span>
            </span>
            <span className="flex items-center gap-2 text-micro text-fg-3">
              {loading ? (
                placeholder("w-24")
              ) : (
                <>
                  {row ? <SessionLabel kind={sessionOf(row.marketState)} quiet /> : null}
                  <TradeTime def={def} row={row} now={now} />
                </>
              )}
            </span>
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="mono w-[3.75rem] shrink-0 font-medium text-fg">{def.code}</span>
            <span className="truncate text-fg-2" title={def.label[lang]}>
              {def.label[lang]}
            </span>
          </span>
        ),
    },
    compact
      ? null
      : {
          key: "session",
          header: t.markets.cols.session,
          width: "5.25rem",
          hideBelow: "md",
          render: ({ row }) => (loading ? placeholder("w-12") : row ? <SessionLabel kind={sessionOf(row.marketState)} /> : <span className="text-fg-3">—</span>),
        },
    compact
      ? null
      : {
          key: "time",
          header: t.markets.cols.localTime,
          width: "6.25rem",
          hideBelow: "sm",
          render: ({ def, row }) => (loading ? placeholder("w-12") : <TradeTime def={def} row={row} now={now} className="text-fg-2" />),
        },
    {
      key: "last",
      header: t.markets.cols.last,
      align: "right",
      width: "5.5rem",
      render: ({ def, row }) => (loading ? placeholder("w-14") : <TickNumber value={row?.price}>{formatNumber(row?.price, def.digits, lang)}</TickNumber>),
    },
    compact
      ? null
      : {
          key: "chg",
          header: t.markets.cols.change,
          align: "right",
          width: "5.5rem",
          hideBelow: "md",
          render: ({ row }) => (loading ? placeholder("w-10") : <Delta value={row?.change} kind="change" lang={lang} />),
        },
    {
      key: "chgPct",
      header: t.markets.cols.changePct,
      align: "right",
      width: "4.5rem",
      render: ({ row }) => (loading ? placeholder("w-10") : <Delta value={row?.changePercent} />),
    },
    {
      key: "trend",
      header: t.markets.cols.trend,
      align: "right",
      width: compact ? "4.25rem" : "5rem",
      hideBelow: compact ? undefined : "sm",
      render: ({ row }) =>
        loading ? (
          placeholder(compact ? "w-11" : "w-16")
        ) : row && row.spark.length > 1 ? (
          <Sparkline data={row.spark} width={compact ? 44 : 56} height={18} tone={directionOf(row.changePercent)} />
        ) : (
          <span className="num text-fg-3">—</span>
        ),
    },
  ];

  return (
    <DataTable
      rows={entries}
      columns={columns.filter((column): column is DataTableColumn<WorldEntry> => column !== null)}
      rowKey={({ def }) => def.symbol}
      caption={caption}
      rowHref={({ def }) => stockPath(def.symbol)}
    />
  );
}
