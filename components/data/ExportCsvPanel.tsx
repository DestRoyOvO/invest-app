"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { useHoldings } from "@/hooks/useHoldings";
import { useWatchlist } from "@/hooks/useWatchlist";
import { localDate } from "@/lib/backup";
import { positionsCsvRows, POSITIONS_TEMPLATE_ROWS, watchlistCsvRows } from "@/lib/broker-import";
import { tpl } from "@/lib/format";

import { downloadCsv } from "./browser";
import { fetchQuoteInfo, type SymbolInfo } from "./symbol-check";
import { TOUCH } from "./styles";

type Busy = "positions" | "watchlist" | null;

/** Quotes for an export; null when they cannot be loaded, so the file is still saved without prices. */
async function quotesFor(symbols: readonly string[]): Promise<Map<string, SymbolInfo> | null> {
  if (symbols.length === 0) return new Map();
  try {
    return (await fetchQuoteInfo(symbols)).found;
  } catch {
    return null;
  }
}

/** CSV files of the positions and the watchlist (with current prices when available) and the import template. */
export function ExportCsvPanel() {
  const { t } = usePrefs();
  const toast = useToast();
  const { holdings } = useHoldings();
  const { symbols, hydrated } = useWatchlist();
  const [busy, setBusy] = useState<Busy>(null);
  const held = Object.keys(holdings);

  const saved = (file: string, priced: boolean) => toast.show({ message: tpl(priced ? t.data.exportCsv.saved : t.data.exportCsv.noPrices, { file }) });

  const exportPositions = async () => {
    setBusy("positions");
    const quotes = await quotesFor(held);
    const file = `investseek-positions-${localDate(new Date())}.csv`;
    downloadCsv(file, positionsCsvRows(holdings, quotes));
    setBusy(null);
    saved(file, quotes !== null);
  };

  const exportWatchlist = async () => {
    setBusy("watchlist");
    const quotes = await quotesFor(symbols);
    const file = `investseek-watchlist-${localDate(new Date())}.csv`;
    downloadCsv(file, watchlistCsvRows(symbols, quotes));
    setBusy(null);
    saved(file, quotes !== null);
  };

  const exportTemplate = () => {
    const file = "investseek-positions-template.csv";
    downloadCsv(file, POSITIONS_TEMPLATE_ROWS);
    saved(file, true);
  };

  const items = [
    { key: "positions", name: t.data.exportCsv.positions, hint: held.length > 0 ? t.data.exportCsv.positionsHint : t.data.exportCsv.noPositions, disabled: held.length === 0, run: exportPositions },
    { key: "watchlist", name: t.data.exportCsv.watchlist, hint: t.data.exportCsv.watchlistHint, disabled: !hydrated || symbols.length === 0, run: exportWatchlist },
    { key: "template", name: t.data.exportCsv.template, hint: t.data.exportCsv.templateHint, disabled: false, run: exportTemplate },
  ] as const;

  return (
    <Panel title={t.data.exportCsv.title}>
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm text-fg">{item.name}</div>
              <div className="text-xs text-fg-3">{item.hint}</div>
            </div>
            <Button
              size="sm"
              disabled={item.disabled || busy !== null}
              aria-busy={busy === item.key || undefined}
              aria-label={tpl(t.data.exportCsv.download, { name: item.name })}
              onClick={() => void item.run()}
              className={TOUCH}
            >
              <Download aria-hidden className="size-3.5" strokeWidth={1.75} />
              {t.data.exportCsv.format}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
