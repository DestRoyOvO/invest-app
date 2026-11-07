"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Delta, directionOf } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { TickNumber } from "@/components/ui/TickNumber";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatNumber, tpl } from "@/lib/format";

import { localTradeTime, sessionOf, type SessionKind, type WorldEntry } from "./world";

const DOT: Record<SessionKind, string> = {
  open: "bg-fg",
  pre: "border border-fg-2",
  post: "border border-fg-2",
  closed: "bg-fg-3",
  unknown: "border border-fg-3",
};

/** The session as a word with a small neutral dot (filled while the regular session trades, hollow in extended hours). */
export function SessionLabel({ kind }: { kind: SessionKind }) {
  const { t } = usePrefs();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", DOT[kind])} />
      <span className={kind === "open" ? "text-fg" : "text-fg-2"}>{t.markets.session[kind]}</span>
    </span>
  );
}

interface WorldTableProps {
  entries: WorldEntry[];
  caption: string;
  /** Narrow panels: market, last, change and the 1M line only. */
  compact?: boolean;
  /** Reference time for "today" in the local trade times: when the server assembled the board. */
  now: number;
}

/**
 * One region of the world board: the instrument, its session and the exchange-local time of the last trade, the
 * price, the change and a neutral one-month line. Rows link to the quote page.
 */
export function WorldTable({ entries, caption, compact = false, now }: WorldTableProps) {
  const { t, lang } = usePrefs();

  const columns: Array<DataTableColumn<WorldEntry> | null> = [
    {
      key: "market",
      header: t.markets.cols.market,
      render: ({ def }) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="mono w-[3.75rem] shrink-0 font-medium text-fg">{def.code}</span>
          <span className="truncate text-fg-2">{def.label[lang]}</span>
        </span>
      ),
    },
    compact
      ? null
      : {
          key: "session",
          header: t.markets.cols.session,
          width: "6rem",
          hideBelow: "md",
          render: ({ row }) => <SessionLabel kind={sessionOf(row?.marketState ?? null)} />,
        },
    compact
      ? null
      : {
          key: "time",
          header: t.markets.cols.localTime,
          width: "6.25rem",
          hideBelow: "sm",
          render: ({ def, row }) => (
            <time dateTime={row?.time ?? undefined} className="num text-fg-2">
              {localTradeTime(row?.time ?? null, def.timeZone, lang, now)}
              <span className="sr-only"> {tpl(t.markets.localTimeOf, { place: def.place[lang] })}</span>
            </time>
          ),
        },
    {
      key: "last",
      header: t.markets.cols.last,
      align: "right",
      width: "6.25rem",
      render: ({ def, row }) => <TickNumber value={row?.price}>{formatNumber(row?.price, def.digits, lang)}</TickNumber>,
    },
    compact
      ? null
      : {
          key: "chg",
          header: t.markets.cols.change,
          align: "right",
          width: "5.5rem",
          hideBelow: "md",
          render: ({ row }) => <Delta value={row?.change} kind="change" lang={lang} />,
        },
    {
      key: "chgPct",
      header: t.markets.cols.changePct,
      align: "right",
      width: "5rem",
      render: ({ row }) => <Delta value={row?.changePercent} />,
    },
    {
      key: "trend",
      header: t.markets.cols.trend,
      align: "right",
      width: compact ? "4.75rem" : "6rem",
      hideBelow: compact ? undefined : "sm",
      render: ({ row }) => <Sparkline data={row?.spark ?? []} width={compact ? 52 : 64} height={18} tone={directionOf(row?.changePercent)} />,
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
