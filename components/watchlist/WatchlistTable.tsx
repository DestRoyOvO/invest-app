"use client";

import { Bell, GripVertical, MoreHorizontal, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { EarningsBadge, quoteColumns, TAG } from "@/components/market/QuoteTable";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { IconButton } from "@/components/ui/Button";
import { DataTable, type DataTableColumn, type SortState } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import type { Holdings, Position } from "@/hooks/useHoldings";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useNow } from "@/hooks/usePortfolio";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { plural } from "@/lib/i18n/plural";
import { displayName } from "@/lib/names-zh";
import type { Quote, Sparklines } from "@/types/api";

import { formatShares } from "./format";

export interface WatchRow {
  symbol: string;
  /** Position in the investor's own order. */
  index: number;
  /** Undefined while the quote is loading (the row shows dashes). */
  quote: Quote | undefined;
  position: Position | undefined;
}

interface DragState {
  symbol: string;
  from: number;
  /** Index in the list without the dragged row where it would land. */
  target: number;
  /** Indicator offset from the top of the table wrapper, in px. */
  lineY: number;
}

const sheetButton = "flex h-11 w-full items-center gap-3 rounded-xs px-3 text-left text-sm text-fg transition-colors hover:bg-hover disabled:text-fg-3";

/** Phone action sheet for one row (the desktop row shows icon buttons instead). */
function RowSheet({ row, ordered, count, onClose, onMove, onRemove }: { row: WatchRow; ordered: boolean; count: number; onClose: () => void; onMove: (delta: -1 | 1) => void; onRemove: () => void }) {
  const { t } = usePrefs();
  const { openPositionEditor, openAlertEditor } = useUi();
  const act = (run: () => void) => () => {
    onClose();
    run();
  };
  return (
    <Drawer open onClose={onClose} title={tpl(t.watchlist.actions, { symbol: row.symbol })} side="bottom">
      <div className="space-y-0.5 p-2">
        <Link href={stockPath(row.symbol)} onClick={onClose} className={sheetButton} data-autofocus>
          {t.watchlist.openQuote}
        </Link>
        <button type="button" className={sheetButton} onClick={act(() => openPositionEditor(row.symbol))}>
          {row.position ? tpl(t.portfolio.editShort, { symbol: row.symbol }) : tpl(t.watchlist.addPositionFor, { symbol: row.symbol })}
        </button>
        <button type="button" className={sheetButton} onClick={act(() => openAlertEditor(row.symbol))}>
          {t.watchlist.setAlertShort}
        </button>
        {ordered ? (
          <>
            <button type="button" className={sheetButton} disabled={row.index === 0} onClick={act(() => onMove(-1))}>
              {t.watchlist.moveUp}
            </button>
            <button type="button" className={sheetButton} disabled={row.index >= count - 1} onClick={act(() => onMove(1))}>
              {t.watchlist.moveDown}
            </button>
          </>
        ) : null}
        <button type="button" className={sheetButton} onClick={act(onRemove)}>
          {t.watchlist.removeShort}
        </button>
      </div>
    </Drawer>
  );
}

interface WatchlistTableProps {
  /** The investor's own order. */
  symbols: readonly string[];
  quotes: ReadonlyMap<string, Quote>;
  holdings: Holdings;
  sparklines?: Sparklines;
  sort: SortState | null;
  onSortChange: (sort: SortState | null) => void;
  /** Move a symbol to an index of the investor's own order. */
  onMove: (symbol: string, index: number) => void;
  /** Remove a symbol; `index` is its place in the investor's own order (for an undo in place). */
  onRemove: (symbol: string, index: number) => void;
  /** Element to focus when the last row is removed. */
  emptyFocusId?: string;
  loading: boolean;
  empty: ReactNode;
  caption: string;
}

/**
 * The watchlist on DataTable: sortable heads (the sort is a view; the stored order never changes), the investor's own
 * order with a drag handle and Alt+Up/Down, a POS tag on held symbols, an earnings badge within 14 days, pre-market and
 * after-hours lines, and row actions (edit position, set alert, remove) on hover and focus, or in a sheet on phones.
 */
export function WatchlistTable({ symbols, quotes, holdings, sparklines, sort, onSortChange, onMove, onRemove, emptyFocusId, loading, empty, caption }: WatchlistTableProps) {
  const { t, lang } = usePrefs();
  const { openPositionEditor, openAlertEditor } = useUi();
  const now = useNow();
  const hintId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ symbol: string | null; part: "link" | "grip" } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const ordered = sort === null;

  const rows = useMemo<WatchRow[]>(() => symbols.map((symbol, index) => ({ symbol, index, quote: quotes.get(symbol), position: holdings[symbol] })), [symbols, quotes, holdings]);
  const anyExtended = rows.some((r) => r.quote?.extendedSession && r.quote.extendedPrice !== null);

  // Put focus back after a move (React may re-insert the moved row) or on the next row after a removal.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const root = wrapperRef.current;
    if (target.symbol === null) {
      if (emptyFocusId) document.getElementById(emptyFocusId)?.focus();
      return;
    }
    const selector = target.part === "grip" ? `[data-wl-grip="${CSS.escape(target.symbol)}"]` : `[data-wl-symbol="${CSS.escape(target.symbol)}"]`;
    const el = root?.querySelector<HTMLElement>(selector);
    const focusable = target.part === "grip" ? el : el?.closest<HTMLElement>("a");
    if (focusable && document.activeElement !== focusable) focusable.focus();
  }, [rows, emptyFocusId]);

  const domOrder = () => Array.from(wrapperRef.current?.querySelectorAll<HTMLElement>("[data-wl-symbol]") ?? []).map((el) => el.dataset.wlSymbol ?? "");

  const remove = (symbol: string) => {
    const order = domOrder();
    const at = order.indexOf(symbol);
    const next = order[at + 1] ?? order[at - 1] ?? null;
    pendingFocus.current = { symbol: next, part: "link" };
    onRemove(symbol, symbols.indexOf(symbol));
  };

  const move = (symbol: string, delta: -1 | 1, part: "link" | "grip") => {
    const from = symbols.indexOf(symbol);
    const to = from + delta;
    if (!ordered || from < 0 || to < 0 || to >= symbols.length) return;
    pendingFocus.current = { symbol, part };
    onMove(symbol, to);
    setAnnouncement(tpl(t.watchlist.moved, { symbol, n: to + 1, total: symbols.length }));
  };

  const focusedRowSymbol = (): string | null => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !wrapperRef.current?.contains(active)) return null;
    return active.closest("tr")?.querySelector<HTMLElement>("[data-wl-symbol]")?.dataset.wlSymbol ?? null;
  };
  useHotkeys([
    { key: "ArrowUp", alt: true, description: t.watchlist.moveUp, when: () => ordered && focusedRowSymbol() !== null, handler: () => move(focusedRowSymbol() as string, -1, document.activeElement?.hasAttribute("data-wl-grip") ? "grip" : "link") },
    { key: "ArrowDown", alt: true, description: t.watchlist.moveDown, when: () => ordered && focusedRowSymbol() !== null, handler: () => move(focusedRowSymbol() as string, 1, document.activeElement?.hasAttribute("data-wl-grip") ? "grip" : "link") },
  ]);

  // Pointer drag on the handle: the drop target is where the pointer sits among the other rows' midpoints.
  const dragTarget = (clientY: number, from: number): { target: number; lineY: number } => {
    const wrapper = wrapperRef.current;
    const rects = Array.from(wrapper?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? []).map((tr) => tr.getBoundingClientRect());
    const others = rects.filter((_, i) => i !== from);
    const target = others.filter((r) => (r.top + r.bottom) / 2 < clientY).length;
    const top = wrapper?.getBoundingClientRect().top ?? 0;
    const edge = others.length === 0 ? (rects[from]?.top ?? top) : target === 0 ? others[0].top : others[target - 1].bottom;
    return { target, lineY: edge - top };
  };

  const gripHandlers = (symbol: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!ordered || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      const from = symbols.indexOf(symbol);
      setDrag({ symbol, from, ...dragTarget(event.clientY, from) });
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (drag?.symbol === symbol) setDrag({ ...drag, ...dragTarget(event.clientY, drag.from) });
    },
    onPointerUp: () => {
      if (drag?.symbol !== symbol) return;
      setDrag(null);
      if (drag.target !== drag.from) {
        pendingFocus.current = { symbol, part: "grip" };
        onMove(symbol, drag.target);
        setAnnouncement(tpl(t.watchlist.moved, { symbol, n: drag.target + 1, total: symbols.length }));
      }
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        event.stopPropagation();
        setDrag(null);
      } else if (!event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        move(symbol, event.key === "ArrowUp" ? -1 : 1, "grip");
      }
    },
  });

  const symbolColumn: DataTableColumn<WatchRow> = {
    key: "symbol",
    header: t.columns.symbol,
    // Room for a 6-character ticker and the POS tag ("7203.T POS"); a longer ticker squeezes the tag, never itself.
    width: "7.25rem",
    sortValue: (row) => row.symbol,
    render: (row) => {
      const posLabel = row.position ? plural(t.watchlist.posLabel, row.position.shares, { shares: formatShares(row.position.shares, lang) }) : "";
      return (
        <span className="block min-w-0 py-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span data-wl-symbol={row.symbol} className="mono shrink-0 font-medium text-fg">
              {row.symbol}
            </span>
            {row.position ? (
              <span title={posLabel} className={cn(TAG, "min-w-0 overflow-hidden border-line-2 text-fg-2")}>
                <span aria-hidden>{t.watchlist.pos}</span>
                <span className="sr-only">, {posLabel}</span>
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 sm:hidden">
            <span className="truncate text-micro text-fg-3" title={row.quote?.name}>
              {displayName(row.symbol, row.quote?.name, lang) ?? ""}
            </span>
            <EarningsBadge quote={row.quote} now={now} t={t} lang={lang} />
          </span>
        </span>
      );
    },
  };

  const gripColumn: DataTableColumn<WatchRow> = {
    key: "order",
    header: <span className="sr-only">{t.columns.order}</span>,
    width: "3.25rem",
    align: "center",
    hideBelow: "sm",
    render: (row) => (
      <button
        type="button"
        data-wl-grip={row.symbol}
        aria-label={tpl(t.watchlist.reorder, { symbol: row.symbol })}
        aria-describedby={hintId}
        title={t.watchlist.reorderHint}
        {...gripHandlers(row.symbol)}
        className="inline-flex size-7 cursor-grab touch-none items-center justify-center rounded-xs text-fg-3 transition-colors hover:bg-hover hover:text-fg active:cursor-grabbing sm:compact:size-6"
      >
        <GripVertical aria-hidden className="size-3.5" strokeWidth={1.75} />
      </button>
    ),
  };

  const columns: DataTableColumn<WatchRow>[] = [
    symbolColumn,
    ...quoteColumns<WatchRow>(["name", "last", "changePct", "marketCap", "pe", "trend"], (row) => row.quote, {
      t,
      lang,
      sparklines,
      extendedHours: anyExtended,
      earnings: true,
      now,
      sortable: true,
      hide: { marketCap: "lg", pe: "lg", trend: "md" },
    }),
    ...(ordered ? [gripColumn] : []),
  ];

  const actions = (row: WatchRow) => (
    <>
      <span className="hidden items-center sm:inline-flex">
        <IconButton
          size="sm"
          label={row.position ? tpl(t.portfolio.editShort, { symbol: row.symbol }) : tpl(t.watchlist.addPositionFor, { symbol: row.symbol })}
          icon={<Pencil className="size-3.5" strokeWidth={1.75} />}
          onClick={() => openPositionEditor(row.symbol)}
        />
        <IconButton size="sm" label={tpl(t.watchlist.setAlert, { symbol: row.symbol })} icon={<Bell className="size-3.5" strokeWidth={1.75} />} onClick={() => openAlertEditor(row.symbol)} />
        <IconButton size="sm" label={tpl(t.watchlist.remove, { symbol: row.symbol })} icon={<X className="size-3.5" strokeWidth={1.75} />} onClick={() => remove(row.symbol)} />
      </span>
      <span className="sm:hidden">
        <IconButton size="sm" label={tpl(t.watchlist.actions, { symbol: row.symbol })} icon={<MoreHorizontal className="size-4" strokeWidth={1.75} />} onClick={() => setSheet(row.symbol)} />
      </span>
    </>
  );

  const sheetRow = sheet ? rows.find((r) => r.symbol === sheet) : undefined;

  return (
    <div ref={wrapperRef} className="relative">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.symbol}
        caption={caption}
        sort={sort}
        onSortChange={onSortChange}
        tieBreak={(a, b) => a.index - b.index}
        rowHref={(row) => stockPath(row.symbol)}
        rowActions={actions}
        actionsWidth="6rem"
        actionsTouchWidth="3.25rem"
        rowClassName={(row) => (drag?.symbol === row.symbol ? "opacity-50" : undefined)}
        loading={loading}
        loadingRows={Math.min(Math.max(symbols.length, 3), 8)}
        empty={empty}
      />
      {drag ? <div aria-hidden className="pointer-events-none absolute inset-x-0 h-0.5 -translate-y-1/2 bg-accent" style={{ top: drag.lineY }} /> : null}
      <p id={hintId} className="sr-only">
        {t.watchlist.reorderHint}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {sheetRow ? (
        <RowSheet
          row={sheetRow}
          ordered={ordered}
          count={symbols.length}
          onClose={() => setSheet(null)}
          onMove={(delta) => move(sheetRow.symbol, delta, "link")}
          onRemove={() => remove(sheetRow.symbol)}
        />
      ) : null}
    </div>
  );
}
