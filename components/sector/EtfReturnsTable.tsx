"use client";

import { useMemo } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Delta } from "@/components/ui/Delta";
import { ErrorState } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { stockPath } from "@/lib/api-client";
import { formatPrice } from "@/lib/format";
import { displayName } from "@/lib/names-zh";
import type { HistoryResponse, Quote } from "@/types/api";

import { EMPTY_RETURNS, trailingReturns, type TrailingReturns } from "./etf-returns";

/** One decimal below 10%, none above, so the five return columns fit a narrow column. */
function returnDigits(value: number | null): number {
  return value !== null && Math.abs(value) >= 0.0995 ? 0 : 1;
}

/**
 * The five return columns are narrow (with tighter cell padding) so the ETF column keeps room for its symbol, price and
 * name in the 22rem right-hand column; the headers are two to three characters in both languages.
 */
const RETURN_WIDTH = "3.25rem";
const RETURN_CELL = "px-1.5!";

interface EtfRow {
  quote: Quote;
  returns: TrailingReturns;
}

interface EtfReturnsTableProps {
  quotes: Quote[];
  history: HistoryResponse | undefined;
  /** The history request failed: the return cells show dashes, with a note and a retry under the table. */
  historyError?: unknown;
  onRetryHistory?: () => void;
}

/**
 * The sector's ETFs: symbol, last price and name, today's change and trailing returns over a week, a month, three
 * months and the year.
 */
export function EtfReturnsTable({ quotes, history, historyError, onRetryHistory }: EtfReturnsTableProps) {
  const { t, lang } = usePrefs();
  const rows = useMemo<EtfRow[]>(
    () =>
      quotes.map((quote) => {
        const closes = history?.closes[quote.symbol];
        return { quote, returns: history && closes ? trailingReturns(history.dates, closes) : EMPTY_RETURNS };
      }),
    [quotes, history],
  );

  // Two or three ETFs per sector: a fixed order (the sector ETF first) reads better than sortable columns here.
  const ret = (key: keyof TrailingReturns, header: string): DataTableColumn<EtfRow> => ({
    key,
    header,
    align: "right",
    width: RETURN_WIDTH,
    className: RETURN_CELL,
    render: (row) => <Delta value={row.returns[key]} kind="ratio" digits={returnDigits(row.returns[key])} />,
  });

  const columns: DataTableColumn<EtfRow>[] = [
    {
      key: "etf",
      header: t.markets.sector.etf,
      render: (row) => (
        <span className="block py-0.5">
          <span className="flex items-baseline gap-1.5">
            <span className="mono font-medium text-fg">{row.quote.symbol}</span>
            <TickNumber value={row.quote.price} className="text-fg-2">
              {formatPrice(row.quote.price, lang)}
            </TickNumber>
          </span>
          <span className="block truncate text-micro text-fg-3" title={row.quote.name}>
            {displayName(row.quote.symbol, row.quote.name, lang)}
          </span>
        </span>
      ),
    },
    {
      key: "d1",
      header: t.markets.sector.d1,
      align: "right",
      width: RETURN_WIDTH,
      className: RETURN_CELL,
      render: (row) => <Delta value={row.quote.changePercent} digits={row.quote.changePercent !== null && Math.abs(row.quote.changePercent) >= 9.95 ? 0 : 1} />,
    },
    ret("w1", t.markets.sector.w1),
    ret("m1", t.markets.sector.m1),
    ret("m3", t.markets.sector.m3),
    ret("ytd", t.markets.sector.ytd),
  ];

  return (
    <>
      <DataTable rows={rows} columns={columns} rowKey={(row) => row.quote.symbol} caption={t.markets.sector.etfReturns} rowHref={(row) => stockPath(row.quote.symbol)} />
      {historyError && !history ? (
        <ErrorState error={historyError} title={t.markets.sector.returnsUnavailable} onRetry={onRetryHistory} compact className="border-t border-line" />
      ) : (
        <p className="border-t border-line px-3 py-1.5 text-micro text-fg-3">{t.markets.sector.returnsNote}</p>
      )}
    </>
  );
}
