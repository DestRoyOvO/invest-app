"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatCompact, formatPrice } from "@/lib/format";
import type { Quote } from "@/types/api";

export type QuoteColumn = "name" | "last" | "change" | "changePct" | "volume" | "dollarVolume" | "marketCap" | "pe" | "trend";

interface QuoteTableProps {
  quotes: Quote[];
  columns: QuoteColumn[];
  sparklines?: Record<string, number[]>;
  /** Extra trailing cell per row (e.g. a remove button). */
  rowAction?: (quote: Quote) => ReactNode;
  caption?: string;
  dense?: boolean;
}

const RIGHT = new Set<QuoteColumn>(["last", "change", "changePct", "volume", "dollarVolume", "marketCap", "pe"]);

/** Dense quote table. The whole row is clickable; the symbol is a real link for keyboard and screen readers. */
export function QuoteTable({ quotes, columns, sparklines, rowAction, caption, dense = true }: QuoteTableProps) {
  const { t, lang } = usePrefs();
  const router = useRouter();
  const headers: Record<QuoteColumn, string> = {
    name: t.columns.name,
    last: t.columns.last,
    change: t.columns.change,
    changePct: t.columns.changePct,
    volume: t.columns.volume,
    dollarVolume: t.columns.dollarVolume,
    marketCap: t.columns.marketCap,
    pe: t.columns.pe,
    trend: t.columns.trend,
  };
  // Phones keep symbol, last, change % and the row actions; the rest needs at least the sm breakpoint.
  const hideOnNarrow = (col: QuoteColumn) =>
    col === "name" || col === "volume" || col === "marketCap" || col === "pe" || col === "change" || col === "trend" ? "hidden sm:table-cell" : "";

  const cell = (col: QuoteColumn, q: Quote): ReactNode => {
    switch (col) {
      case "name":
        return <span className="block max-w-[14rem] truncate text-fg-3">{q.name}</span>;
      case "last":
        return <span className="num text-fg">{formatPrice(q.price, lang)}</span>;
      case "change":
        return <Delta value={q.change} kind="change" lang={lang} />;
      case "changePct":
        return <Delta value={q.changePercent} />;
      case "volume":
        return <span className="num text-fg-2">{formatCompact(q.volume, lang)}</span>;
      case "dollarVolume":
        return <span className="num text-fg-2">{formatCompact(q.price !== null && q.volume !== null ? q.price * q.volume : null, lang)}</span>;
      case "marketCap":
        return <span className="num text-fg-2">{formatCompact(q.marketCap, lang)}</span>;
      case "pe":
        return <span className="num text-fg-2">{q.trailingPE !== null ? q.trailingPE.toFixed(1) : "—"}</span>;
      case "trend":
        return <Sparkline data={sparklines?.[q.symbol] ?? []} width={72} height={20} />;
    }
  };

  return (
    <table className="w-full table-fixed border-collapse text-data">
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="label h-8 w-[5.5rem] px-3 text-left font-normal">
            {t.columns.symbol}
          </th>
          {columns.map((col) => (
            <th
              key={col}
              scope="col"
              className={cn("label h-8 px-3 font-normal", RIGHT.has(col) ? "text-right" : "text-left", col === "trend" && "w-[6.5rem]", hideOnNarrow(col))}
            >
              {headers[col]}
            </th>
          ))}
          {rowAction ? <th scope="col" className="w-[4.5rem]" /> : null}
        </tr>
      </thead>
      <tbody>
        {quotes.map((q) => (
          <tr
            key={q.symbol}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a,button")) return;
              router.push(stockPath(q.symbol));
            }}
            className="cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-hover"
          >
            <td className={cn("px-3", dense ? "h-8" : "h-10")}>
              <Link href={stockPath(q.symbol)} className="num font-medium text-fg hover:text-accent">
                {q.symbol}
              </Link>
            </td>
            {columns.map((col) => (
              <td key={col} className={cn("px-3 whitespace-nowrap", RIGHT.has(col) ? "text-right" : "text-left", hideOnNarrow(col))}>
                {cell(col, q)}
              </td>
            ))}
            {rowAction ? <td className="pr-2 text-right">{rowAction(q)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
