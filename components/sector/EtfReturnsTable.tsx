"use client";

import { useMemo } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Delta } from "@/components/ui/Delta";
import { stockPath } from "@/lib/api-client";
import type { HistoryResponse, Quote } from "@/types/api";

import { EMPTY_RETURNS, trailingReturns, type TrailingReturns } from "./etf-returns";

/** One decimal below 10%, none above, so the five return columns fit a narrow column. */
function returnDigits(value: number | null): number {
  return value !== null && Math.abs(value) >= 0.0995 ? 0 : 1;
}

interface EtfRow {
  quote: Quote;
  returns: TrailingReturns;
}

/** The sector's ETFs with today's change and trailing returns over a week, a month, three months and the year. */
export function EtfReturnsTable({ quotes, history }: { quotes: Quote[]; history: HistoryResponse | undefined }) {
  const { t } = usePrefs();
  const rows = useMemo<EtfRow[]>(
    () =>
      quotes.map((quote) => {
        const closes = history?.closes[quote.symbol];
        return { quote, returns: history && closes ? trailingReturns(history.dates, closes) : EMPTY_RETURNS };
      }),
    [quotes, history],
  );

  const ret = (key: keyof TrailingReturns, header: string): DataTableColumn<EtfRow> => ({
    key,
    header,
    align: "right",
    width: "4.25rem",
    render: (row) => <Delta value={row.returns[key]} kind="ratio" digits={returnDigits(row.returns[key])} />,
    sortValue: (row) => row.returns[key],
  });

  const columns: DataTableColumn<EtfRow>[] = [
    {
      key: "symbol",
      header: t.columns.symbol,
      render: (row) => (
        <span className="mono font-medium text-fg" title={row.quote.name}>
          {row.quote.symbol}
        </span>
      ),
    },
    {
      key: "d1",
      header: t.markets.sector.d1,
      align: "right",
      width: "4.25rem",
      render: (row) => <Delta value={row.quote.changePercent} digits={row.quote.changePercent !== null && Math.abs(row.quote.changePercent) >= 9.95 ? 0 : 1} />,
      sortValue: (row) => row.quote.changePercent,
    },
    ret("w1", t.markets.sector.w1),
    ret("m1", t.markets.sector.m1),
    ret("m3", t.markets.sector.m3),
    ret("ytd", t.markets.sector.ytd),
  ];

  return (
    <>
      <DataTable rows={rows} columns={columns} rowKey={(row) => row.quote.symbol} caption={t.markets.sector.etfReturns} rowHref={(row) => stockPath(row.quote.symbol)} />
      <p className="border-t border-line px-3 py-1.5 text-micro text-fg-3">{t.markets.sector.returnsNote}</p>
    </>
  );
}
